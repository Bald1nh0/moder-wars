import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exercise the actual shell used after push, without Docker or registry writes.
const workflow = readFileSync(
	new URL("../.github/workflows/check-and-deploy.yml", import.meta.url),
	"utf8",
);
assert.ok(!workflow.includes("{{index .RepoDigests 0}}"));
const selectors = [
	...workflow.matchAll(
		/image=\$\(docker inspect --format '\{\{json \.RepoDigests\}\}' "\$tag" \|[\s\S]*?'\)/g,
	),
];
assert.equal(selectors.length, 2, "Production and development select digests");
const dir = mkdtempSync(join(tmpdir(), "mw-publish-smoke-"));
const docker = join(dir, "docker");
writeFileSync(
	docker,
	'#!/bin/sh\n[ "$1" = inspect ] || exit 99\nprintf "%s\\n" "$DOCKER_INSPECT_FIXTURE"\n',
);
chmodSync(docker, 0o700);
let checks = 0;
try {
	for (const [index, match] of selectors.entries()) {
		const repository = `ghcr.io/bald1nh0/moder-wars${index === 0 ? "-dev" : ""}`;
		const digest = `${repository}@sha256:${"a".repeat(64)}`;
		const local = `modern-wars-ci@sha256:${"a".repeat(64)}`;
		const other = `ghcr.io/bald1nh0/moder-wars-other@sha256:${"a".repeat(64)}`;
		const validation = workflow
			.slice(match.index + match[0].length)
			.match(/\[\[ "\$image" =~ [^\n]+ \]\]/)?.[0];
		assert.ok(validation, "Digest format validation remains mandatory");
		const fixtures = [
			[[local, digest], true],
			[[digest, local], true],
			[[other, local, digest], true],
			[[digest, digest], true],
			[[digest], true],
			[[], false],
			[[local, other], false],
			[[digest, `${repository}@sha256:${"b".repeat(64)}`], false],
			[null, false],
			[[`${repository}@sha256:short`], false],
			[[`${repository}@sha256:${"a".repeat(64)}suffix`], false],
		];
		for (const [digests, succeeds] of fixtures) {
			const result = spawnSync(
				"bash",
				[
					"-c",
					`set -euo pipefail\n${match[0]}\n${validation}\nprintf '%s\\n' "$image"`,
				],
				{
					encoding: "utf8",
					env: {
						...process.env,
						PATH: `${dir}:${process.env.PATH}`,
						repository,
						tag: `${repository}:test`,
						DOCKER_INSPECT_FIXTURE: JSON.stringify(digests),
					},
				},
			);
			assert.equal(result.status === 0, succeeds, result.stderr);
			if (succeeds) assert.equal(result.stdout.trim(), digest);
			checks++;
		}
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}
console.log(`Published image digest selection: ${checks} checks passed.`);
