import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analysisSourceIdentity } from "./codeql-source-identity.mjs";
import { bumpVersion } from "./release-version.mjs";

const gate = fileURLToPath(new URL("./codeql-gate.mjs", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "mw-codeql-gate-"));
assert.equal(spawnSync("git", ["init", "--quiet", root]).status, 0);
const reviewPath = join(root, "reviews.json");
writeFileSync(reviewPath, "[]");
const report = (results = []) => ({
	version: "2.1.0",
	runs: [{ tool: { driver: { name: "CodeQL" } }, results }],
});
let tests = 0;
function check(value, expectedStatus) {
	const directory = mkdtempSync(join(root, "case-"));
	if (value !== undefined)
		writeFileSync(
			join(directory, "javascript.sarif"),
			typeof value === "string" ? value : JSON.stringify(value),
		);
	const result = spawnSync(
		process.execPath,
		[gate, directory, reviewPath, root],
		{
			encoding: "utf8",
		},
	);
	assert.equal(result.status, expectedStatus, result.stderr);
	assert.ok(
		!`${result.stdout}${result.stderr}`.includes("sensitive-fixture-value"),
	);
	tests++;
}
try {
	check(report(), 0);
	for (const incrementalMode of ["diff-informed", "overlay,diff-informed"]) {
		const partial = report();
		partial.runs[0].properties = { incrementalMode };
		check(partial, 1);
	}
	check(undefined, 1);
	check("{sensitive-fixture-value", 1);
	check({ version: "2.1.0", runs: [] }, 1);
	check(
		{ version: "2.1.0", runs: [{ tool: { driver: { name: "CodeQL" } } }] },
		1,
	);
	check({ version: "1.0", runs: report().runs }, 1);
	check(
		report([
			{ ruleId: "js/xss", message: { text: "sensitive-fixture-value" } },
		]),
		1,
	);
	const unsuccessful = report();
	unsuccessful.runs[0].invocations = [{ executionSuccessful: false }];
	check(unsuccessful, 1);
	const foreign = report();
	foreign.runs[0].tool.driver.name = "Unexpected";
	check(foreign, 1);
	const source = "const displayColor = Math.random();\n";
	writeFileSync(join(root, "game.js"), source);
	const reviewed = {
		ruleId: "js/insecure-randomness",
		path: "game.js",
		line: 1,
		column: 22,
		endLine: 1,
		endColumn: 35,
		count: 1,
		sourceSha256: createHash("sha256").update(source).digest("hex"),
		analysisSha256: analysisSourceIdentity(root, reviewPath),
		reason:
			"Game display color has no authentication or cryptographic purpose.",
	};
	const finding = {
		ruleId: reviewed.ruleId,
		locations: [
			{
				physicalLocation: {
					artifactLocation: { uri: reviewed.path },
					region: { startLine: 1, startColumn: 22, endColumn: 35 },
				},
			},
		],
	};
	writeFileSync(reviewPath, JSON.stringify([reviewed]));
	check(report([finding]), 0);
	check(report([finding, finding]), 1);
	check(report([{ ...finding, ruleId: "js/xss" }]), 1);
	check(report(), 1);
	writeFileSync(join(root, "game.js"), `${source}// Changed context\n`);
	check(report([finding]), 1);
	writeFileSync(join(root, "game.js"), source);
	writeFileSync(join(root, "caller.js"), "const untrustedInput = true;\n");
	check(report([finding]), 1);
	rmSync(join(root, "caller.js"));
	const otherColumn = structuredClone(finding);
	otherColumn.locations[0].physicalLocation.region.startColumn = 23;
	check(report([otherColumn]), 1);
	writeFileSync(reviewPath, JSON.stringify([{ ...reviewed, reason: "" }]));
	check(report([finding]), 1);
	writeFileSync(reviewPath, JSON.stringify([reviewed, reviewed]));
	check(report([finding]), 1);
	writeFileSync(
		reviewPath,
		JSON.stringify([{ ...reviewed, path: "../outside.js" }]),
	);
	check(report([finding]), 1);

	// Only application-version metadata may change without invalidating the review.
	const packagePath = join(root, "package.json");
	const lockPath = join(root, "package-lock.json");
	const pkg = {
		name: "fixture",
		version: "0.30.0",
		scripts: { build: "node build.mjs" },
		dependencies: { dependency: "1.0.0" },
	};
	const lock = {
		name: "fixture",
		version: "0.30.0",
		lockfileVersion: 3,
		packages: {
			"": {
				name: "fixture",
				version: "0.30.0",
				dependencies: { dependency: "1.0.0" },
			},
			"node_modules/dependency": {
				version: "1.0.0",
				integrity: "sha512-fixture",
				resolved: "https://example.com/dependency.tgz",
			},
		},
	};
	const resetMetadata = () => {
		writeFileSync(packagePath, JSON.stringify(pkg));
		writeFileSync(lockPath, JSON.stringify(lock));
	};
	resetMetadata();
	const metadataReview = {
		...reviewed,
		analysisSha256: analysisSourceIdentity(root, reviewPath),
	};
	writeFileSync(reviewPath, JSON.stringify([metadataReview]));
	check(report([finding]), 0);
	for (const increment of ["patch", "minor", "major"]) {
		bumpVersion(increment, root);
		check(report([finding]), 0);
	}
	assert.equal(
		spawnSync("git", [
			"-C",
			root,
			"add",
			"game.js",
			"package.json",
			"package-lock.json",
		]).status,
		0,
	);
	check(report([finding]), 0);
	resetMetadata();
	writeFileSync(packagePath, JSON.stringify(pkg, null, 2));
	writeFileSync(lockPath, JSON.stringify(lock, null, "\t"));
	check(report([finding]), 0);
	for (const mutate of [
		(p) => {
			p.scripts.build = "node other-build.mjs";
		},
		(p) => {
			p.dependencies.dependency = "2.0.0";
		},
		(_p, l) => {
			l.packages["node_modules/dependency"].version = "2.0.0";
		},
		(_p, l) => {
			l.packages["node_modules/dependency"].integrity = "sha512-changed";
		},
		(_p, l) => {
			l.packages["node_modules/dependency"].resolved =
				"https://example.com/other.tgz";
		},
		(_p, l) => {
			l.packages[""].dependencies.dependency = "2.0.0";
		},
		(p) => {
			p.version = "0.30.1";
		},
		(p, l) => {
			p.version = l.version = l.packages[""].version = "invalid";
		},
		(_p, l) => {
			delete l.packages[""].version;
		},
	]) {
		const changedPackage = structuredClone(pkg);
		const changedLock = structuredClone(lock);
		mutate(changedPackage, changedLock);
		writeFileSync(packagePath, JSON.stringify(changedPackage));
		writeFileSync(lockPath, JSON.stringify(changedLock));
		check(report([finding]), 1);
	}
	console.log(`CodeQL gate: ${tests} checks passed.`);
} finally {
	rmSync(root, { recursive: true, force: true });
}
