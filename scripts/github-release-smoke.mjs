import assert from "node:assert/strict";
import {
	changelogNotes,
	createGitHubClient,
	draftRelease,
	preflight,
	publishRelease,
} from "./github-release.mjs";

const sha = "a".repeat(40);
const otherSha = "b".repeat(40);
const image = `ghcr.io/example/game@sha256:${"c".repeat(64)}`;
const input = { repository: "Example/game", version: "1.2.3", sha, image };
const prefix = "/repos/Example/game";

function fixture() {
	const state = {
		calls: [],
		tag: null,
		release: null,
		assets: [],
		manifest: null,
		annotated: null,
	};
	const request = async (path, options = {}) => {
		state.calls.push({ path, ...options });
		const method = options.method ?? "GET";
		if (path.startsWith(`${prefix}/git/ref/tags/`) && method === "GET")
			return state.tag;
		if (path.startsWith(`${prefix}/git/tags/`))
			return { object: state.annotated };
		if (path === `${prefix}/git/refs` && method === "POST") {
			assert.equal(options.body.ref, `refs/tags/v${input.version}`);
			state.tag = { object: { type: "commit", sha: options.body.sha } };
			return state.tag;
		}
		if (path.startsWith(`${prefix}/releases?`) && method === "GET")
			return state.release ? [state.release] : [];
		if (path === `${prefix}/releases` && method === "POST") {
			state.release = {
				...options.body,
				id: 42,
				html_url: "https://github.com/Example/game/releases/tag/v1.2.3",
				upload_url:
					"https://uploads.github.com/repos/Example/game/releases/42/assets{?name,label}",
			};
			return state.release;
		}
		if (path.startsWith(`${prefix}/releases/42/assets?`)) return state.assets;
		if (path.startsWith("https://uploads.github.com/") && method === "POST") {
			state.assets = [{ id: 7, name: "release-manifest.json" }];
			state.manifest = options.body;
			return state.assets[0];
		}
		if (path === `${prefix}/releases/assets/7`) {
			assert.equal(options.raw, true);
			return state.manifest;
		}
		if (path === `${prefix}/releases/42` && method === "PATCH") {
			state.release = { ...state.release, ...options.body };
			return state.release;
		}
		throw new Error(`Unexpected mock API request: ${method} ${path}`);
	};
	return { state, request };
}

let count = 0;
async function test(name, run) {
	await run();
	console.log(`PASS: ${name}`);
	count++;
}

await test("new version preflight performs no mutations", async () => {
	const { state, request } = fixture();
	const result = await preflight(request, input);
	assert.equal(result.existing_image, "");
	assert.ok(state.calls.every((call) => !call.method));
});
await test("draft records exact commit and immutable image; publication is separate", async () => {
	const { state, request } = fixture();
	const result = await draftRelease(request, input, "- Fix a bug.");
	assert.equal(result.existing_image, image);
	assert.equal(state.tag.object.sha, sha);
	assert.equal(state.release.target_commitish, sha);
	assert.equal(state.release.draft, true);
	assert.deepEqual(state.manifest, {
		version: "1.2.3",
		gitSha: sha,
		image,
		imageTag: "ghcr.io/example/game:v1.2.3",
	});
	const release = await publishRelease(request, input);
	assert.equal(release.draft, false);
	assert.equal(release.prerelease, false);
	assert.equal(release.make_latest, "true");
});
await test("reruns reuse the existing image and never mutate a published release", async () => {
	const { state, request } = fixture();
	await draftRelease(request, input, "- First notes.");
	const before = state.calls.filter((call) => call.method).length;
	await draftRelease(request, input, "- Different notes do not overwrite.");
	assert.equal(state.calls.filter((call) => call.method).length, before);
	await publishRelease(request, input);
	const after = state.calls.filter((call) => call.method).length;
	await publishRelease(request, input);
	await draftRelease(request, input, "- Ignored.");
	assert.equal(state.calls.filter((call) => call.method).length, after);
	assert.equal(
		(await preflight(request, { ...input, image: undefined })).existing_image,
		image,
	);
});
await test("another commit cannot claim the same Git tag", async () => {
	const { state, request } = fixture();
	state.tag = { object: { type: "commit", sha: otherSha } };
	await assert.rejects(preflight(request, input), /another commit/);
	assert.ok(state.calls.every((call) => !call.method));
});
await test("annotated tags are checked against the underlying commit", async () => {
	const { state, request } = fixture();
	state.tag = { object: { type: "tag", sha: otherSha } };
	state.annotated = { type: "commit", sha };
	assert.equal((await preflight(request, input)).tagCommit, sha);
	state.annotated.sha = otherSha;
	await assert.rejects(preflight(request, input), /another commit/);
});
await test("changed manifest digest or commit is rejected", async () => {
	const { state, request } = fixture();
	await draftRelease(request, input, "- Change.");
	await assert.rejects(
		draftRelease(
			request,
			{ ...input, image: `${image.slice(0, -64)}${"d".repeat(64)}` },
			"- Change.",
		),
		/different image digest/,
	);
	state.manifest.gitSha = otherSha;
	await assert.rejects(preflight(request, input), /manifest does not match/);
});
await test("draft upload interruption can resume, but published missing manifest fails closed", async () => {
	const { state, request } = fixture();
	await draftRelease(request, input, "- Change.");
	state.assets = [];
	state.manifest = null;
	await draftRelease(request, input, "- Change.");
	assert.equal(state.manifest.image, image);
	state.release.draft = false;
	state.assets = [];
	await assert.rejects(preflight(request, input), /missing its manifest/);
});
await test("publish requires an already prepared draft", async () => {
	const { request } = fixture();
	await assert.rejects(
		publishRelease(request, input),
		/draft with matching tag and manifest/,
	);
});
await test("prereleases are not marked latest", async () => {
	const { state, request } = fixture();
	const prerelease = { ...input, version: "1.2.3-rc.1" };
	// Seed the already reserved version rather than the fixture's stable-tag creation branch.
	state.tag = { object: { type: "commit", sha } };
	await draftRelease(request, prerelease, "- Candidate.");
	const release = await publishRelease(request, prerelease);
	assert.equal(release.prerelease, true);
	assert.equal(release.make_latest, "false");
});
await test("API authentication failures are not treated as missing releases", async () => {
	const request = createGitHubClient(
		"test-token",
		async () => new Response("Forbidden", { status: 403 }),
	);
	await assert.rejects(preflight(request, input), /403/);
});
await test("release and asset searches follow pagination", async () => {
	const { state, request } = fixture();
	await draftRelease(request, input, "- Change.");
	const paginated = async (path, options) => {
		if (path === `${prefix}/releases?per_page=100&page=1`)
			return Array.from({ length: 100 }, (_, index) => ({
				tag_name: `unrelated-${index}`,
			}));
		if (path === `${prefix}/releases?per_page=100&page=2`)
			return [state.release];
		if (path === `${prefix}/releases/42/assets?per_page=100&page=1`)
			return Array.from({ length: 100 }, (_, index) => ({
				name: `unrelated-${index}`,
			}));
		if (path === `${prefix}/releases/42/assets?per_page=100&page=2`)
			return state.assets;
		return request(path, options);
	};
	assert.equal((await preflight(paginated, input)).existing_image, image);
});
await test("HTTP client uploads JSON and authenticates only approved GitHub hosts", async () => {
	const seen = [];
	const request = createGitHubClient("test-token", async (url, options) => {
		seen.push({ url, options });
		return new Response('{"ok":true}', {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	});
	await request(
		"https://uploads.github.com/repos/Example/game/releases/42/assets?name=release-manifest.json",
		{ method: "POST", upload: true, body: { image } },
	);
	assert.deepEqual(JSON.parse(seen[0].options.body), { image });
	assert.equal(seen[0].options.headers.Authorization, "Bearer test-token");
	await assert.rejects(
		request("https://example.com/"),
		/Unexpected GitHub API host/,
	);
	assert.equal(seen.length, 1);
});
await test("changelog extraction uses the exact version section", async () => {
	const source =
		"# Changelog\n## 2026-10-29\n### 1.2.30\n- Wrong.\n### 1.2.3 (unreleased)\n\n- Correct.\n\n### 1.2.2\n- Older.\n";
	assert.equal(changelogNotes("1.2.3", source), "- Correct.");
	assert.throws(() => changelogNotes("1.0.0", source), /no section/);
});
console.log(`All ${count} GitHub release smoke checks passed.`);
