import {
	appendFileSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const files = [
	"package.json",
	"package-lock.json",
	"index.html",
	"workers/service-worker.js",
];
const titlePattern = /(<title>MW-V)([^<]+)(<\/title>)/g;
const cachePattern = /(const CACHE_VERSION = "mw-v)([^"]+)(";)/g;

export function parseVersion(version) {
	if (typeof version !== "string" || version.includes("+")) {
		throw new Error(
			"Use SemVer without build metadata (+...), which Docker tags cannot represent directly.",
		);
	}
	const match =
		/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
			version,
		);
	if (
		!match ||
		match[0] !== version ||
		match[4]?.split(".").some((part) => /^\d+$/.test(part) && /^0\d/.test(part))
	) {
		throw new Error(`Invalid SemVer: ${version}`);
	}
	if (version.length + 1 > 128)
		throw new Error(
			"The v-prefixed version exceeds Docker's 128-character tag limit.",
		);
	const parts = match.slice(1, 4).map(Number);
	if (parts.some((part) => !Number.isSafeInteger(part)))
		throw new Error("Version components exceed safe integer limits.");
	return { version, tag: `v${version}`, prerelease: Boolean(match[4]), parts };
}

function oneMatch(source, pattern, name) {
	const matches = [...source.matchAll(pattern)];
	if (matches.length !== 1)
		throw new Error(`Expected exactly one version marker in ${name}.`);
	return matches[0][2];
}

export function checkVersion(root = process.cwd()) {
	const sources = files.map((file) =>
		readFileSync(resolve(root, file), "utf8"),
	);
	const pkg = JSON.parse(sources[0]);
	const lock = JSON.parse(sources[1]);
	const info = parseVersion(pkg.version);
	const versions = [
		["package-lock.json", lock.version],
		['package-lock.json packages[""]', lock.packages?.[""]?.version],
		["index.html", oneMatch(sources[2], titlePattern, files[2])],
		["workers/service-worker.js", oneMatch(sources[3], cachePattern, files[3])],
	];
	for (const [file, version] of versions) {
		if (version !== info.version)
			throw new Error(
				`${file} has ${version}; expected ${info.version}. Use the version bump command to update all markers together.`,
			);
	}
	return { version: info.version, tag: info.tag, prerelease: info.prerelease };
}

export function nextVersion(current, increment) {
	const {
		parts: [major, minor, patch],
		prerelease,
	} = parseVersion(current);
	let next;
	// Match npm's promotion behavior when the current version is a prerelease.
	if (increment === "major")
		next = `${prerelease && minor === 0 && patch === 0 ? major : major + 1}.0.0`;
	else if (increment === "minor")
		next = `${major}.${prerelease && patch === 0 ? minor : minor + 1}.0`;
	else if (increment === "patch")
		next = `${major}.${minor}.${prerelease ? patch : patch + 1}`;
	else next = increment;
	return parseVersion(next).version;
}

export function compareVersions(left, right) {
	const a = parseVersion(left);
	const b = parseVersion(right);
	for (let index = 0; index < 3; index++) {
		if (a.parts[index] !== b.parts[index])
			return a.parts[index] < b.parts[index] ? -1 : 1;
	}
	if (!a.prerelease || !b.prerelease)
		return a.prerelease === b.prerelease ? 0 : a.prerelease ? -1 : 1;
	const aParts = left.slice(left.indexOf("-") + 1).split(".");
	const bParts = right.slice(right.indexOf("-") + 1).split(".");
	for (let index = 0; index < Math.max(aParts.length, bParts.length); index++) {
		if (aParts[index] === bParts[index]) continue;
		if (aParts[index] === undefined) return -1;
		if (bParts[index] === undefined) return 1;
		const aNumeric = /^\d+$/.test(aParts[index]);
		const bNumeric = /^\d+$/.test(bParts[index]);
		if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
		return (
			aNumeric
				? BigInt(aParts[index]) < BigInt(bParts[index])
				: aParts[index] < bParts[index]
		)
			? -1
			: 1;
	}
	return 0;
}

function formatJSON(value, original) {
	const indent = /\n([\t ]+)"/.exec(original)?.[1] ?? "  ";
	return `${JSON.stringify(value, null, indent)}\n`;
}

export function bumpVersion(increment, root = process.cwd()) {
	const current = checkVersion(root);
	const version = nextVersion(current.version, increment);
	if (compareVersions(version, current.version) <= 0)
		throw new Error("A version bump must increase SemVer precedence.");
	const originals = files.map((file) =>
		readFileSync(resolve(root, file), "utf8"),
	);
	const pkg = JSON.parse(originals[0]);
	const lock = JSON.parse(originals[1]);
	pkg.version = version;
	lock.version = version;
	lock.packages[""].version = version;
	const updated = [
		formatJSON(pkg, originals[0]),
		formatJSON(lock, originals[1]),
		originals[2].replace(
			titlePattern,
			(_match, start, _version, end) => `${start}${version}${end}`,
		),
		originals[3].replace(
			cachePattern,
			(_match, start, _version, end) => `${start}${version}${end}`,
		),
	];
	const temp = files.map((file) =>
		resolve(root, `${file}.version-${process.pid}.tmp`),
	);
	let replaced = 0;
	const prepared = [];
	try {
		// Prepare every file before replacing any marker; restore originals on failure.
		temp.forEach((file, index) => {
			writeFileSync(file, updated[index], { flag: "wx" });
			prepared.push(file);
		});
		files.forEach((file, index) => {
			renameSync(temp[index], resolve(root, file));
			replaced++;
		});
	} catch (error) {
		for (let index = 0; index < replaced; index++)
			writeFileSync(resolve(root, files[index]), originals[index]);
		throw error;
	} finally {
		for (const file of prepared) rmSync(file, { force: true });
	}
	return checkVersion(root);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	try {
		const [command, ...args] = process.argv.slice(2);
		if (command !== "check" && command !== "bump")
			throw new Error(
				"Usage: release-version.mjs check [--github-output] | bump patch|minor|major|VERSION",
			);
		if (command === "check" && args.some((arg) => arg !== "--github-output"))
			throw new Error("Unknown check option.");
		if (command === "bump" && args.length !== 1)
			throw new Error("Specify one version or increment.");
		const info = command === "check" ? checkVersion() : bumpVersion(args[0]);
		if (args.includes("--github-output")) {
			if (!process.env.GITHUB_OUTPUT)
				throw new Error("GITHUB_OUTPUT is required.");
			appendFileSync(
				process.env.GITHUB_OUTPUT,
				Object.entries(info)
					.map(([key, value]) => `${key}=${value}\n`)
					.join(""),
			);
		}
		console.log(JSON.stringify(info));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
