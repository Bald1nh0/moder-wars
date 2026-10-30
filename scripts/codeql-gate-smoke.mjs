import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analysisSourceIdentity } from "./codeql-source-identity.mjs";

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
	console.log(`CodeQL gate: ${tests} checks passed.`);
} finally {
	rmSync(root, { recursive: true, force: true });
}
