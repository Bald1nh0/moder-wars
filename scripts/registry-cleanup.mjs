import { pathToFileURL } from "node:url";

const repository = "Bald1nh0/moder-wars";
const imagePrefix = "ghcr.io/bald1nh0/moder-wars@";
const apiPath = "/users/Bald1nh0/packages/container/moder-wars/versions";
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const identifier = "(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)";
const versionTag = new RegExp(
	`^v?(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-${identifier}(?:\\.${identifier})*)?$`,
);
const shaTag = /^sha-[a-f0-9]{40}$/;
const day = 24 * 60 * 60 * 1000;

export function protectedDigest(image) {
	if (typeof image !== "string" || !image.startsWith(imagePrefix)) {
		throw new Error(
			"Protected images must use the production GHCR repository and an immutable digest.",
		);
	}
	const digest = image.slice(imagePrefix.length);
	if (!digestPattern.test(digest))
		throw new Error("Invalid protected image digest.");
	return digest;
}

function validateVersion(version) {
	const tags = version?.metadata?.container?.tags;
	const created = version?.created_at;
	const validDate =
		typeof created === "string" &&
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(created) &&
		Number.isFinite(Date.parse(created)) &&
		new Date(created).toISOString() ===
			(created.includes(".") ? created : created.replace("Z", ".000Z"));
	if (
		!Number.isSafeInteger(version?.id) ||
		version.id <= 0 ||
		!digestPattern.test(version?.name ?? "") ||
		!validDate ||
		!Array.isArray(tags) ||
		tags.some((tag) => typeof tag !== "string" || !tag)
	) {
		throw new Error(
			"Incomplete or invalid package metadata; refusing cleanup.",
		);
	}
	return {
		id: version.id,
		digest: version.name,
		createdAt: version.created_at,
		tags: [...tags].sort(),
	};
}

export function planCleanup(versions, { current, previous, now = Date.now() }) {
	if (!Number.isFinite(now)) throw new Error("Invalid cleanup clock.");
	const protectedDigests = new Set([protectedDigest(current)]);
	if (previous !== undefined) protectedDigests.add(protectedDigest(previous));
	if (!Array.isArray(versions))
		throw new Error("Invalid package version response.");
	const normalized = versions.map(validateVersion);
	if (
		new Set(normalized.map((item) => item.id)).size !== normalized.length ||
		new Set(normalized.map((item) => item.digest)).size !== normalized.length
	) {
		throw new Error(
			"Repeated package versions; listing may have changed during pagination.",
		);
	}
	for (const digest of protectedDigests) {
		if (!normalized.some((item) => item.digest === digest)) {
			throw new Error(
				"A protected production image is missing from the registry listing; refusing cleanup.",
			);
		}
	}
	normalized.sort(
		(a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id,
	);
	const kept = [];
	const eligible = [];
	for (const [index, item] of normalized.entries()) {
		let reason;
		if (protectedDigests.has(item.digest)) reason = "production-or-rollback";
		else if (index < 20) reason = "newest-20";
		else if (Date.parse(item.createdAt) >= now - 30 * day)
			reason = "younger-than-30-days";
		else if (item.tags.length === 0) reason = "untagged-manifest";
		else if (item.tags.some((tag) => tag.startsWith("keep-")))
			reason = "explicit-pin";
		else if (
			item.tags.some((tag) => !versionTag.test(tag) && !shaTag.test(tag))
		)
			reason = "unmanaged-tag";
		if (reason) kept.push({ ...item, reason });
		else eligible.push(item);
	}
	// Bound each run and retire the oldest known releases first.
	eligible.reverse();
	return {
		kept,
		candidates: eligible.slice(0, 10),
		deferred: eligible.slice(10),
	};
}

export async function cleanupRegistry({
	current,
	previous,
	apply = false,
	token,
	repo,
	fetchImpl = fetch,
	now = Date.now(),
	log = console.log,
}) {
	if (repo !== repository)
		throw new Error(`Cleanup is restricted to ${repository}.`);
	if (!token) throw new Error("GITHUB_TOKEN is required.");
	// Validate protected inputs before contacting GitHub.
	protectedDigest(current);
	if (previous !== undefined) protectedDigest(previous);
	async function api(path, method = "GET") {
		const response = await fetchImpl(`https://api.github.com${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
			redirect: "error",
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok)
			throw new Error(
				`GitHub ${method} ${path} failed: HTTP ${response.status}. No further deletions will be attempted.`,
			);
		return method === "DELETE" ? undefined : response.json();
	}
	const versions = [];
	let complete = false;
	for (let page = 1; page <= 100; page++) {
		const items = await api(
			`${apiPath}?state=active&per_page=100&page=${page}`,
		);
		if (!Array.isArray(items) || items.length > 100)
			throw new Error("Invalid package listing page.");
		versions.push(...items);
		if (items.length < 100) {
			complete = true;
			break;
		}
	}
	if (!complete)
		throw new Error(
			"Package pagination limit reached; refusing partial cleanup.",
		);
	const plan = planCleanup(versions, { current, previous, now });
	log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...plan }, null, 2));
	if (apply) {
		// Complete every preflight before the first destructive request.
		for (const candidate of plan.candidates) {
			const fresh = validateVersion(await api(`${apiPath}/${candidate.id}`));
			if (JSON.stringify(fresh) !== JSON.stringify(candidate)) {
				throw new Error(
					"Package metadata changed after planning; refusing cleanup.",
				);
			}
		}
		for (const candidate of plan.candidates) {
			await api(`${apiPath}/${candidate.id}`, "DELETE");
			log(`Deleted package version ${candidate.id} (${candidate.digest}).`);
		}
	}
	return plan;
}

export function parseArguments(argv) {
	const options = { apply: false };
	const seen = new Set();
	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index];
		if (seen.has(flag)) throw new Error(`Repeated option: ${flag}`);
		seen.add(flag);
		if (flag === "--apply") options.apply = true;
		else if (flag === "--current" || flag === "--previous") {
			const value = argv[++index];
			if (!value || value.startsWith("--"))
				throw new Error(`Missing value for ${flag}`);
			options[flag.slice(2)] = value;
		} else throw new Error(`Unknown option: ${flag}`);
	}
	if (!options.current)
		throw new Error(
			"Usage: node scripts/registry-cleanup.mjs --current IMAGE [--previous IMAGE] [--apply]",
		);
	return options;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	try {
		await cleanupRegistry({
			...parseArguments(process.argv.slice(2)),
			token: process.env.GITHUB_TOKEN,
			repo: process.env.GITHUB_REPOSITORY,
		});
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
