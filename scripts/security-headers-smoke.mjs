import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const container = process.argv[2];
assert.match(
	container ?? "",
	/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,
	"Pass the running test container name",
);

function request(path, options = []) {
	const output = execFileSync(
		"docker",
		[
			"exec",
			container,
			"curl",
			"--silent",
			"--show-error",
			"--max-time",
			"10",
			"--dump-header",
			"-",
			"--output",
			"/dev/null",
			...options,
			`http://127.0.0.1:8080${path}`,
		],
		{ encoding: "utf8", timeout: 15_000 },
	);
	const [statusLine, ...lines] = output.trim().split(/\r?\n/);
	const status = Number(statusLine.split(" ")[1]);
	const headers = new Map();
	for (const line of lines) {
		const colon = line.indexOf(":");
		if (colon > 0)
			headers.set(
				line.slice(0, colon).toLowerCase(),
				line.slice(colon + 1).trim(),
			);
	}
	assert.equal(
		headers.get("content-security-policy"),
		"frame-ancestors 'none'",
		path,
	);
	assert.equal(headers.get("x-frame-options"), "DENY", path);
	assert.equal(headers.get("x-content-type-options"), "nosniff", path);
	assert.equal(
		headers.get("referrer-policy"),
		"strict-origin-when-cross-origin",
		path,
	);
	return { status, headers };
}

for (const path of ["/", "/index.html", "/service-worker.js"]) {
	for (const options of [[], ["--head"]]) {
		const result = request(path, options);
		assert.equal(result.status, 200, path);
		assert.equal(result.headers.get("cache-control"), "no-cache", path);
	}
}

const index = request("/index.html?cache-check=1");
assert.equal(index.headers.get("cache-control"), "no-cache");
assert.ok(index.headers.get("etag"), "Nginx provides an index validator");
assert.equal(
	request("/index.html", [
		"--header",
		`If-None-Match: ${index.headers.get("etag")}`,
	]).status,
	304,
);
assert.match(
	request("/service-worker.js").headers.get("content-type"),
	/javascript/,
);
assert.equal(request("/assets").status, 301);
assert.equal(request("/__missing_security_check__.html").status, 404);

const binary = request("/assets/maps/compiled/world-map-2026-v3.mwsc.gz");
assert.equal(binary.status, 200);
assert.equal(
	binary.headers.has("content-encoding"),
	false,
	"The game decodes binary gzip assets",
);
assert.equal(
	request("/assets/maps/compiled/world-map-2026-v3.mwsc.gz", [
		"--range",
		"0-31",
	]).status,
	206,
);
console.log(
	"Security headers passed for GET, HEAD, 200, 206, 301, 304, 404, cache policy and binary assets.",
);
