import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Bind reviewed findings to callers and configuration as well as the sink.
// Include current uncommitted inputs for local checks; CI uses the same paths.
export function analysisSourceIdentity(root, reviewPath) {
	const paths = [
		...new Set(
			execFileSync(
				"git",
				[
					"-C",
					root,
					"ls-files",
					"-z",
					"--cached",
					"--others",
					"--exclude-standard",
				],
				{ encoding: "utf8" },
			).split("\0"),
		),
	]
		.filter(
			(path) =>
				/\.(?:[cm]?js|jsx|tsx?|html|json|ya?ml)$/.test(path) &&
				resolve(root, path) !== resolve(reviewPath) &&
				existsSync(resolve(root, path)),
		)
		.sort();
	if (paths.length === 0)
		throw new Error("No analysis source files were found.");
	const hash = createHash("sha256");
	for (const path of paths) {
		const contents = readFileSync(resolve(root, path));
		hash.update(JSON.stringify([path, contents.length]));
		hash.update(contents);
	}
	return hash.digest("hex");
}
