import assert from "node:assert/strict";
import {
	cleanupRegistry,
	parseArguments,
	planCleanup,
} from "./registry-cleanup.mjs";

const now = Date.parse("2026-10-29T12:00:00Z");
const digest = (id) => `sha256:${id.toString(16).padStart(64, "0")}`;
const image = (id) => `ghcr.io/bald1nh0/moder-wars@${digest(id)}`;
const version = (
	id,
	tags = [`v0.${id}.0`],
	created = "2026-01-01T00:00:00Z",
) => ({
	id,
	name: digest(id),
	created_at: created,
	metadata: { container: { tags } },
});
const base = Array.from({ length: 40 }, (_, index) => version(index + 1));
let checks = 0;
async function test(name, check) {
	await check();
	checks++;
	console.log(`PASS: ${name}`);
}
function mockApi(
	versions,
	{ failurePage = 0, changedId = 0, deleteFailureId = 0 } = {},
) {
	const calls = [];
	return {
		calls,
		fetchImpl: async (url, options) => {
			calls.push({ url, method: options.method });
			assert.equal(options.redirect, "error");
			const parsed = new URL(url);
			const page = Number(parsed.searchParams.get("page"));
			const id = Number(parsed.pathname.split("/").at(-1));
			if (page) {
				if (page === failurePage)
					return new Response("Forbidden", { status: 403 });
				return Response.json(versions.slice((page - 1) * 100, page * 100));
			}
			if (options.method === "DELETE")
				return new Response(null, {
					status: id === deleteFailureId ? 403 : 204,
				});
			const value = structuredClone(versions.find((item) => item.id === id));
			if (id === changedId) value.metadata.container.tags.push("keep-now");
			return Response.json(value);
		},
	};
}
function options(mock, extra = {}) {
	return {
		current: image(40),
		previous: image(1),
		now,
		token: "test-token",
		repo: "Bald1nh0/moder-wars",
		log() {},
		...mock,
		...extra,
	};
}

await test("retention keeps the newest 20 and old active/rollback images", () => {
	const plan = planCleanup(base, {
		current: image(1),
		previous: image(2),
		now,
	});
	assert.deepEqual(
		plan.candidates.map((item) => item.id),
		[3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
	);
	assert.equal(
		plan.kept.filter((item) => item.reason === "newest-20").length,
		20,
	);
	assert.equal(plan.deferred.length, 8);
});
await test("fresh, pinned, untagged and unmanaged manifests survive", () => {
	const data = [...base, version(41, ["v1.0.0"], "2026-10-28T00:00:00Z")];
	data[0] = version(1, ["v0.1.0", "keep-archive"]);
	data[1] = version(2, []);
	data[2] = version(3, ["latest"]);
	data[3] = version(4, ["v0.4.0", "custom"]);
	const plan = planCleanup(data, { current: image(40), now });
	for (const id of [1, 2, 3, 4, 41])
		assert(plan.kept.some((item) => item.id === id));
});
await test("30-day age boundary is retained even outside newest 20", () => {
	const data = Array.from({ length: 25 }, (_, i) =>
		version(i + 1, [`v0.${i}.0`], "2026-10-29T00:00:00Z"),
	);
	data.push(version(30, ["v1.0.0"], "2026-09-29T12:00:00Z"));
	assert.equal(
		planCleanup(data, { current: image(25), now }).candidates.length,
		0,
	);
});
await test("production inputs, duplicates and incomplete metadata fail closed", () => {
	for (const current of [
		undefined,
		"",
		`ghcr.io/other/repo@${digest(1)}`,
		"ghcr.io/bald1nh0/moder-wars:latest",
		image(999),
	]) {
		assert.throws(() => planCleanup(base, { current, now }));
	}
	assert.throws(() =>
		planCleanup(base, { current: image(1), previous: "", now }),
	);
	assert.throws(() =>
		planCleanup([...base, base[0]], { current: image(1), now }),
	);
	for (const patch of [
		{ created_at: "invalid" },
		{ created_at: "2026-02-30T00:00:00Z" },
		{ metadata: {} },
		{ id: "2" },
		{ name: "not-a-digest" },
	]) {
		assert.throws(() =>
			planCleanup([{ ...version(1), ...patch }], { current: image(1), now }),
		);
	}
});
await test("CLI is dry-run by default and rejects ambiguous arguments", () => {
	assert.equal(parseArguments(["--current", image(1)]).apply, false);
	assert.equal(parseArguments(["--current", image(1), "--apply"]).apply, true);
	for (const args of [
		[],
		["--current"],
		["--current", image(1), "--apply", "--apply"],
		["--unknown"],
	]) {
		assert.throws(() => parseArguments(args));
	}
});
await test("dry-run fetches all pages and never deletes", async () => {
	const mock = mockApi(Array.from({ length: 125 }, (_, i) => version(i + 1)));
	const plan = await cleanupRegistry(options(mock));
	assert.equal(plan.candidates.length, 10);
	assert.equal(mock.calls.length, 2);
	assert(mock.calls.every((call) => call.method === "GET"));
});
await test("failed pagination prevents every deletion", async () => {
	const mock = mockApi(
		Array.from({ length: 125 }, (_, i) => version(i + 1)),
		{ failurePage: 2 },
	);
	await assert.rejects(
		cleanupRegistry(options(mock, { apply: true })),
		/HTTP 403/,
	);
	assert(mock.calls.every((call) => call.method === "GET"));
});
await test("changed candidate metadata aborts before any deletion", async () => {
	const mock = mockApi(base, { changedId: 11 });
	await assert.rejects(
		cleanupRegistry(options(mock, { apply: true })),
		/metadata changed/,
	);
	assert(mock.calls.every((call) => call.method === "GET"));
});
await test("apply deletes only planned versions after complete preflight", async () => {
	const mock = mockApi(base);
	const plan = await cleanupRegistry(options(mock, { apply: true }));
	const deletes = mock.calls.filter((call) => call.method === "DELETE");
	assert.equal(deletes.length, 10);
	assert.equal(
		mock.calls.findIndex((call) => call.method === "DELETE"),
		11,
	);
	assert.deepEqual(
		deletes.map((call) => Number(new URL(call.url).pathname.split("/").at(-1))),
		plan.candidates.map((item) => item.id),
	);
});
await test("delete errors stop subsequent deletions", async () => {
	const mock = mockApi(base, { deleteFailureId: 3 });
	await assert.rejects(
		cleanupRegistry(options(mock, { apply: true })),
		/HTTP 403/,
	);
	assert.equal(mock.calls.filter((call) => call.method === "DELETE").length, 2);
});
await test("unsupported repositories and missing credentials make no API calls", async () => {
	const mock = mockApi(base);
	await assert.rejects(
		cleanupRegistry(options(mock, { repo: "another/repository" })),
		/restricted/,
	);
	await assert.rejects(
		cleanupRegistry(options(mock, { repo: undefined })),
		/restricted/,
	);
	await assert.rejects(
		cleanupRegistry(options(mock, { token: "" })),
		/GITHUB_TOKEN/,
	);
	assert.equal(mock.calls.length, 0);
});
console.log(`All ${checks} registry cleanup smoke checks passed.`);
