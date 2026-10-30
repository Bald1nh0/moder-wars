import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const workflow = readFileSync(
	new URL("../.github/workflows/check-and-deploy.yml", import.meta.url),
	"utf8",
);
assert.doesNotMatch(
	workflow,
	/DEV_DEPLOY_ENABLED|RELEASE_PUBLISHING_ENABLED|DEV_HOSTNAME|PRODUCTION_HOSTNAME|EXPECTED_HOST/,
);
let count = 0;
for (const [job, branch] of [
	["publish-dev", "dev"],
	["deploy-dev", "dev"],
	["publish", "main"],
	["deploy", "main"],
]) {
	const expression = workflow.match(
		new RegExp(`^  ${job}:\\n    if: (.+)$`, "m"),
	)?.[1];
	assert.ok(expression, `${job} keeps an explicit routing condition`);
	for (const event of [
		"push",
		"pull_request",
		"workflow_dispatch",
		"schedule",
	]) {
		for (const ref of ["dev", "main", "feature/test"]) {
			for (const repository of ["Bald1nh0/moder-wars", "someone/moder-wars"]) {
				const github = {
					event_name: event,
					ref: `refs/heads/${ref}`,
					repository,
				};
				// These routing expressions use only equality and boolean operators.
				const actual = runInNewContext(
					expression,
					{ github, vars: {} },
					{ timeout: 100 },
				);
				assert.equal(
					actual,
					event === "push" &&
						ref === branch &&
						repository === "Bald1nh0/moder-wars",
					`${job}: ${JSON.stringify(github)}`,
				);
				count++;
			}
		}
	}
}

const bootstraps = [
	...workflow.matchAll(
		/mkdir -p -- "\$deploy_dir"\n\s+if \[ ! -e "\$deploy_dir\/runtime.env" \]; then[\s\S]*?\n\s+fi/g,
	),
];
assert.equal(bootstraps.length, 2);
const dir = mkdtempSync(join(tmpdir(), "mw-deploy-routing-"));
try {
	for (const [index, match] of bootstraps.entries()) {
		const deployDir = join(dir, String(index));
		const run = () =>
			execFileSync("bash", ["-euc", match[0]], {
				env: { ...process.env, deploy_dir: deployDir },
			});
		run();
		const path = join(deployDir, "runtime.env");
		assert.equal(
			readFileSync(path, "utf8"),
			`MW_BIND_ADDRESS=192.168.30.17\nMW_PORT=${index === 0 ? 4180 : 4174}\n`,
		);
		const existing =
			"# Existing host configuration\nMW_BIND_ADDRESS=127.0.0.1\n";
		writeFileSync(path, existing);
		run();
		assert.equal(readFileSync(path, "utf8"), existing);
		count += 2;
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}
console.log(`Deployment routing and bootstrap: ${count} checks passed.`);
