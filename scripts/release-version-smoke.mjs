import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	bumpVersion,
	checkVersion,
	compareVersions,
	nextVersion,
	parseVersion,
} from "./release-version.mjs";

const root = mkdtempSync(join(tmpdir(), "modern-wars-version-"));
function fixture(version = "0.30.0-experimental.1") {
	mkdirSync(join(root, "workers"), { recursive: true });
	writeFileSync(
		join(root, "package.json"),
		`${JSON.stringify({ name: "game", version, scripts: { check: "unchanged" } }, null, "\t")}\n`,
	);
	writeFileSync(
		join(root, "package-lock.json"),
		`${JSON.stringify({ version, packages: { "": { version }, dependency: { version: "9.9.9" } } }, null, 2)}\n`,
	);
	writeFileSync(
		join(root, "index.html"),
		`<html><title>MW-V${version}</title></html>\n`,
	);
	writeFileSync(
		join(root, "workers/service-worker.js"),
		`const CACHE_VERSION = "mw-v${version}";\nconst unrelated = "9.9.9";\n`,
	);
}
try {
	fixture();
	assert.deepEqual(checkVersion(root), {
		version: "0.30.0-experimental.1",
		tag: "v0.30.0-experimental.1",
		prerelease: true,
	});
	for (const version of [
		"01.2.3",
		"1.2",
		"1.2.3-01",
		"v1.2.3",
		"1.2.3+build",
		"1.2.3-",
		"1.2.3-rc..1",
		"1.2.3\n",
		`1.2.3-${"a".repeat(130)}`,
	])
		assert.throws(() => parseVersion(version));
	for (const version of ["0.0.0", "1.2.3-rc.0", "1.2.3-01abc"])
		assert.equal(parseVersion(version).version, version);
	assert.equal(nextVersion("0.30.0-experimental.1", "patch"), "0.30.0");
	assert.equal(nextVersion("1.2.3", "patch"), "1.2.4");
	assert.equal(nextVersion("1.2.3", "minor"), "1.3.0");
	assert.equal(nextVersion("1.2.3", "major"), "2.0.0");
	assert.equal(nextVersion("2.0.0-rc.1", "major"), "2.0.0");
	bumpVersion("patch", root);
	assert.equal(checkVersion(root).version, "0.30.0");
	assert.equal(
		JSON.parse(readFileSync(join(root, "package-lock.json"))).packages
			.dependency.version,
		"9.9.9",
	);
	assert.match(readFileSync(join(root, "package.json"), "utf8"), /\n\t"name"/);
	bumpVersion("0.31.0-rc.1", root);
	assert.equal(checkVersion(root).version, "0.31.0-rc.1");
	assert.throws(() => bumpVersion("0.30.9", root), /increase SemVer/);
	assert.throws(() => bumpVersion("0.31.0-rc.1", root), /increase SemVer/);
	assert.equal(compareVersions("0.31.0-rc.2", "0.31.0-rc.10"), -1);
	assert.equal(compareVersions("0.31.0-rc.1", "0.31.0"), -1);
	assert.equal(compareVersions("0.31.0-alpha", "0.31.0-2"), 1);
	for (const file of [
		"index.html",
		"workers/service-worker.js",
		"package-lock.json",
	]) {
		fixture();
		writeFileSync(
			join(root, file),
			readFileSync(join(root, file), "utf8").replace(
				"0.30.0-experimental.1",
				"0.30.9",
			),
		);
		const before = readFileSync(join(root, "package.json"), "utf8");
		assert.throws(() => checkVersion(root));
		assert.throws(() => bumpVersion("minor", root));
		assert.equal(readFileSync(join(root, "package.json"), "utf8"), before);
	}
	fixture();
	const lock = JSON.parse(readFileSync(join(root, "package-lock.json")));
	lock.packages[""].version = "0.0.1";
	writeFileSync(join(root, "package-lock.json"), JSON.stringify(lock));
	assert.throws(() => checkVersion(root));
	fixture();
	writeFileSync(
		join(root, "index.html"),
		"<title>MW-V0.30.0-experimental.1</title><title>MW-V0.30.0-experimental.1</title>",
	);
	assert.throws(() => checkVersion(root));
	console.log(
		"Release version smoke checks passed: SemVer, promotion, all markers, mismatch rejection, format/dependency preservation.",
	);
} finally {
	rmSync(root, { recursive: true, force: true });
}
