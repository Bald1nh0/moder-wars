import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseVersion } from "./release-version.mjs";

const assetName = "release-manifest.json";

export function createGitHubClient(token, fetchImpl = fetch) {
	if (!token) throw new Error("GH_TOKEN or GITHUB_TOKEN is required.");
	return async function request(
		path,
		{ method = "GET", body, raw = false, optional = false } = {},
	) {
		const url = path.startsWith("https://")
			? path
			: `https://api.github.com${path}`;
		if (!/^https:\/\/(?:api|uploads)\.github\.com\//.test(url))
			throw new Error("Unexpected GitHub API host.");
		const response = await fetchImpl(url, {
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: raw
					? "application/octet-stream"
					: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"Content-Type": "application/json",
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(30000),
		});
		if (optional && response.status === 404) return null;
		if (!response.ok)
			throw new Error(
				`GitHub ${method} ${new URL(url).pathname} failed (${response.status}): ${(await response.text()).slice(0, 350)}`,
			);
		if (response.status === 204) return null;
		return response.json();
	};
}

function validateInputs(
	{ repository, version, sha, image },
	requireImage = false,
) {
	const info = parseVersion(version);
	if (
		!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") ||
		/[\r\n]/.test(repository)
	)
		throw new Error("GITHUB_REPOSITORY must be owner/repository.");
	if (!/^[a-f0-9]{40}$/.test(sha ?? "") || sha.length !== 40)
		throw new Error("Provide the exact 40-character commit SHA.");
	const imageRepository = `ghcr.io/${repository.toLowerCase()}`;
	if (requireImage || image !== undefined) {
		if (
			!image?.startsWith(`${imageRepository}@sha256:`) ||
			image.length !== imageRepository.length + 72 ||
			!/^[a-f0-9]{64}$/.test(image.slice(imageRepository.length + 8))
		) {
			throw new Error(
				`Image must be an immutable digest under ${imageRepository}.`,
			);
		}
	}
	return {
		...info,
		imageTag: `${imageRepository}:${info.tag}`,
		prefix: `/repos/${repository}`,
	};
}

async function getRelease(request, prefix, tag) {
	// Listing includes authenticated draft releases, unlike a published-tag lookup.
	for (let page = 1; page <= 100; page++) {
		const releases = await request(
			`${prefix}/releases?per_page=100&page=${page}`,
		);
		if (!Array.isArray(releases))
			throw new Error("Invalid release listing response.");
		const matching = releases.filter((release) => release.tag_name === tag);
		if (matching.length > 1)
			throw new Error(
				`Multiple releases use ${tag}; resolve them before continuing.`,
			);
		if (matching.length) return matching[0];
		if (releases.length < 100) return null;
	}
	throw new Error(
		"Release listing exceeded the pagination limit; refusing an incomplete lookup.",
	);
}

async function getTagCommit(request, prefix, tag) {
	const ref = await request(
		`${prefix}/git/ref/tags/${encodeURIComponent(tag)}`,
		{ optional: true },
	);
	if (!ref) return null;
	let object = ref.object;
	for (let depth = 0; depth < 10; depth++) {
		if (object?.type === "commit" && /^[a-f0-9]{40}$/.test(object.sha))
			return object.sha;
		if (object?.type !== "tag" || !/^[a-f0-9]{40}$/.test(object.sha))
			throw new Error(`Invalid tag object for ${tag}.`);
		object = (await request(`${prefix}/git/tags/${object.sha}`)).object;
	}
	throw new Error(`Annotated tag nesting exceeds the limit for ${tag}.`);
}

function validateManifest(manifest, input) {
	const expected = validateInputs({ ...input, image: manifest?.image }, true);
	if (
		manifest.version !== input.version ||
		manifest.gitSha !== input.sha ||
		manifest.imageTag !== expected.imageTag
	) {
		throw new Error(
			"Existing release manifest does not match this version, commit and image tag. Bump the version instead of replacing a release.",
		);
	}
	if (input.image && manifest.image !== input.image)
		throw new Error(
			"The version already belongs to a different image digest. Reuse that image or bump the version.",
		);
	return manifest;
}

export async function preflight(request, input) {
	const info = validateInputs(input);
	const tagCommit = await getTagCommit(request, info.prefix, info.tag);
	if (tagCommit && tagCommit !== input.sha)
		throw new Error(
			`${info.tag} already points to another commit. Bump the application version.`,
		);
	const release = await getRelease(request, info.prefix, info.tag);
	let manifest = null;
	if (release) {
		if (!release.draft && release.prerelease !== info.prerelease)
			throw new Error(
				"Published release prerelease flag disagrees with its SemVer version.",
			);
		if (!tagCommit && !release.draft)
			throw new Error(
				"Published release has no matching Git tag; refusing to repair it implicitly.",
			);
		if (!tagCommit && release.target_commitish !== input.sha)
			throw new Error(
				"Existing draft targets a different or ambiguous commit.",
			);
		const assets = [];
		for (let page = 1; page <= 100; page++) {
			const chunk = await request(
				`${info.prefix}/releases/${release.id}/assets?per_page=100&page=${page}`,
			);
			if (!Array.isArray(chunk))
				throw new Error("Invalid release asset listing.");
			assets.push(...chunk.filter((asset) => asset.name === assetName));
			if (chunk.length < 100) break;
			if (page === 100)
				throw new Error("Asset listing exceeded the pagination limit.");
		}
		if (assets.length > 1)
			throw new Error(
				"Duplicate release manifests; resolve them before continuing.",
			);
		if (assets.length)
			manifest = validateManifest(
				await request(`${info.prefix}/releases/assets/${assets[0].id}`, {
					raw: true,
				}),
				input,
			);
		if (!release.draft && !manifest)
			throw new Error(
				"Published release is missing its manifest; refusing to overwrite it.",
			);
	}
	return {
		...info,
		release,
		manifest,
		tagCommit,
		existing_image: manifest?.image ?? "",
	};
}

export function changelogNotes(version, source) {
	const lines = source.split(/\r?\n/);
	const heading = lines.findIndex(
		(line) =>
			line.startsWith(`### ${version}`) &&
			/^(?:\s|$)/.test(line.slice(4 + version.length)),
	);
	if (heading < 0)
		throw new Error(`CHANGELOG.md has no section for ${version}.`);
	const end = lines.findIndex(
		(line, index) => index > heading && /^#{1,3} /.test(line),
	);
	const notes = lines
		.slice(heading + 1, end < 0 ? undefined : end)
		.join("\n")
		.trim();
	if (!notes) throw new Error(`CHANGELOG.md section ${version} is empty.`);
	return notes;
}

export async function draftRelease(request, input, notes) {
	const info = validateInputs(input, true);
	const state = await preflight(request, input);
	if (state.release && !state.release.draft) return state;
	if (!notes?.trim()) throw new Error("Release notes must not be empty.");
	if (!state.tagCommit)
		await request(`${info.prefix}/git/refs`, {
			method: "POST",
			body: { ref: `refs/tags/${info.tag}`, sha: input.sha },
		});
	let release = state.release;
	if (!release) {
		release = await request(`${info.prefix}/releases`, {
			method: "POST",
			body: {
				tag_name: info.tag,
				target_commitish: input.sha,
				name: `Modern Wars ${info.tag}`,
				draft: true,
				prerelease: info.prerelease,
				body: `${notes.trim()}\n\n## Docker image\n\nVersion tag: \`${info.imageTag}\`\n\nExact image: \`${input.image}\`\n\n\`\`\`sh\ndocker pull ${input.image}\n\`\`\`\n\nThe attached release-manifest.json records the application version, source commit and image digest. Older images may expire under the registry retention policy; the release metadata remains available.\n`,
			},
		});
	}
	if (!state.manifest) {
		const uploadBase = release.upload_url?.replace(/\{.*$/, "");
		if (!uploadBase?.startsWith("https://uploads.github.com/"))
			throw new Error("Missing trusted release upload URL.");
		await request(`${uploadBase}?name=${assetName}`, {
			method: "POST",
			upload: true,
			body: {
				version: input.version,
				gitSha: input.sha,
				image: input.image,
				imageTag: info.imageTag,
			},
		});
	}
	return preflight(request, input);
}

export async function publishRelease(request, input) {
	validateInputs(input, true);
	const state = await preflight(request, input);
	if (!state.release || !state.manifest || !state.tagCommit)
		throw new Error(
			"A draft with matching tag and manifest is required before publication.",
		);
	if (!state.release.draft) return state.release;
	return request(`${state.prefix}/releases/${state.release.id}`, {
		method: "PATCH",
		body: {
			draft: false,
			prerelease: state.prerelease,
			make_latest: state.prerelease ? "false" : "true",
		},
	});
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	try {
		const [command, ...args] = process.argv.slice(2);
		const options = {};
		for (let index = 0; index < args.length; index++) {
			const key = args[index];
			if (key === "--github-output") options.githubOutput = true;
			else if (
				["--version", "--sha", "--image", "--notes-file"].includes(key) &&
				args[index + 1] &&
				!args[index + 1].startsWith("--")
			)
				options[key.slice(2)] = args[++index];
			else throw new Error(`Unknown or incomplete argument: ${key}`);
		}
		if (!["preflight", "draft", "publish"].includes(command))
			throw new Error(
				"Usage: github-release.mjs preflight|draft|publish --version VERSION --sha SHA [--image DIGEST] [--notes-file PATH] [--github-output]",
			);
		const input = {
			repository: process.env.GITHUB_REPOSITORY,
			version: options.version,
			sha: options.sha,
			image: options.image,
		};
		const request = createGitHubClient(
			process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
		);
		let result;
		if (command === "preflight") result = await preflight(request, input);
		if (command === "draft") {
			const notes = options["notes-file"]
				? readFileSync(options["notes-file"], "utf8")
				: changelogNotes(input.version, readFileSync("CHANGELOG.md", "utf8"));
			result = await draftRelease(request, input, notes);
		}
		if (command === "publish") result = await publishRelease(request, input);
		const output =
			command === "publish"
				? { release_url: result.html_url }
				: {
						version: result.version,
						tag: result.tag,
						prerelease: result.prerelease,
						existing_image: result.existing_image,
						release_url: result.release?.html_url ?? "",
					};
		if (options.githubOutput) {
			if (!process.env.GITHUB_OUTPUT)
				throw new Error("GITHUB_OUTPUT is required.");
			for (const value of Object.values(output))
				if (typeof value === "string" && /[\r\n]/.test(value))
					throw new Error("Unexpected newline in GitHub output.");
			appendFileSync(
				process.env.GITHUB_OUTPUT,
				Object.entries(output)
					.map(([key, value]) => `${key}=${value}\n`)
					.join(""),
			);
		}
		console.log(JSON.stringify(output));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
