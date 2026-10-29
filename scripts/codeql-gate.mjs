import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { analysisSourceIdentity } from "./codeql-source-identity.mjs";

// A successful analysis can contain findings. Only exact, reviewed false positives
// may pass; a changed source file or finding requires another review.
try {
	const directory = process.argv[2];
	if (!directory) throw new Error("A CodeQL SARIF directory is required.");
	const root = resolve(
		process.argv[4] || join(dirname(fileURLToPath(import.meta.url)), ".."),
	);
	const reviewPath =
		process.argv[3] || join(root, ".github/codeql-reviewed.json");
	const reviews = existsSync(reviewPath)
		? JSON.parse(readFileSync(reviewPath, "utf8"))
		: [];
	if (!Array.isArray(reviews))
		throw new Error("Invalid reviewed findings document.");
	const sourceIdentity = reviews.length
		? analysisSourceIdentity(root, reviewPath)
		: null;
	const allowed = new Map();
	for (const entry of reviews) {
		if (
			typeof entry.ruleId !== "string" ||
			typeof entry.path !== "string" ||
			!Number.isSafeInteger(entry.line) ||
			entry.line < 1 ||
			!Number.isSafeInteger(entry.count) ||
			entry.count < 1 ||
			typeof entry.reason !== "string" ||
			entry.reason.trim().length < 30 ||
			!/^[a-f0-9]{64}$/.test(entry.sourceSha256 || "") ||
			!/^[a-f0-9]{64}$/.test(entry.analysisSha256 || "") ||
			!Number.isSafeInteger(entry.column) ||
			entry.column < 1 ||
			!Number.isSafeInteger(entry.endLine) ||
			entry.endLine < entry.line ||
			!Number.isSafeInteger(entry.endColumn) ||
			entry.endColumn < 1
		) {
			throw new Error("Invalid reviewed finding identity or rationale.");
		}
		if (entry.analysisSha256 !== sourceIdentity)
			throw new Error("Analysis inputs changed; repeat security triage.");
		const source = resolve(root, entry.path);
		if (!source.startsWith(`${root}${sep}`))
			throw new Error("Invalid reviewed source path.");
		const hash = createHash("sha256")
			.update(readFileSync(source))
			.digest("hex");
		if (hash !== entry.sourceSha256)
			throw new Error("Reviewed source changed; repeat security triage.");
		const key = JSON.stringify([
			entry.ruleId,
			entry.path,
			entry.line,
			entry.column,
			entry.endLine,
			entry.endColumn,
		]);
		if (allowed.has(key)) throw new Error("Duplicate reviewed finding.");
		allowed.set(key, entry.count);
	}
	const files = readdirSync(directory).filter((name) =>
		name.endsWith(".sarif"),
	);
	if (files.length === 0)
		throw new Error("No CodeQL SARIF files were produced.");
	let count = 0;
	let reviewed = 0;
	for (const file of files) {
		const report = JSON.parse(readFileSync(join(directory, file), "utf8"));
		if (
			report.version !== "2.1.0" ||
			!Array.isArray(report.runs) ||
			report.runs.length === 0
		) {
			throw new Error("Missing or unsupported SARIF runs.");
		}
		for (const run of report.runs) {
			if (run.tool?.driver?.name !== "CodeQL" || !Array.isArray(run.results)) {
				throw new Error("Expected CodeQL analysis results.");
			}
			if (
				String(run.properties?.incrementalMode || "").includes("diff-informed")
			) {
				throw new Error(
					"A full CodeQL report is required; disable diff-informed PR analysis.",
				);
			}
			if (
				run.invocations?.some(
					(invocation) => invocation.executionSuccessful === false,
				)
			) {
				throw new Error("CodeQL reported an unsuccessful analysis.");
			}
			for (const result of run.results) {
				const location =
					result.locations?.length === 1
						? result.locations[0].physicalLocation
						: null;
				const key = JSON.stringify([
					result.ruleId,
					location?.artifactLocation?.uri,
					location?.region?.startLine,
					location?.region?.startColumn,
					location?.region?.endLine ?? location?.region?.startLine,
					location?.region?.endColumn,
				]);
				const remaining = allowed.get(key) || 0;
				if (remaining > 0) {
					allowed.set(key, remaining - 1);
					reviewed++;
				} else count++;
			}
		}
	}
	if (count > 0)
		throw new Error(
			`CodeQL reported ${count} unreviewed finding(s); security triage is required.`,
		);
	if ([...allowed.values()].some((remaining) => remaining !== 0)) {
		throw new Error(
			"Reviewed finding no longer matches; remove stale review entries.",
		);
	}
	console.log(
		`CodeQL security gate passed: no unreviewed findings (${reviewed} exact reviewed false positives).`,
	);
} catch (error) {
	// Never print source snippets or parser messages containing scanned content.
	console.error(
		error instanceof SyntaxError
			? "Invalid security report JSON."
			: error.message,
	);
	process.exitCode = 1;
}
