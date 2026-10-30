import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = import.meta.dirname;
const appVersion: string = JSON.parse(
	readFileSync(resolve(root, "package.json"), "utf8"),
).version;
let outputDirectory = resolve(root, "dist");
function paths(directory: string, prefix = ""): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? paths(resolve(directory, entry.name), `${prefix}${entry.name}/`)
			: [`${prefix}${entry.name}`],
	);
}
export default defineConfig({
	server: { port: 4180, strictPort: true },
	preview: { port: 4180, strictPort: true },
	base: "./",
	publicDir: false,
	worker: { format: "es" },
	build: {
		target: "es2022",
		outDir: "dist",
		emptyOutDir: true,
		assetsInlineLimit: 0,
		manifest: true,
	},
	plugins: [
		{
			name: "modern-wars-static-assets",
			transformIndexHtml(html) {
				return html.replace("__MW_APP_VERSION__", appVersion);
			},
			configResolved(config) {
				outputDirectory = resolve(config.root, config.build.outDir);
			},
			closeBundle() {
				const out = outputDirectory;
				mkdirSync(out, { recursive: true });
				cpSync(resolve(root, "assets"), resolve(out, "assets"), {
					recursive: true,
				});
				const files = paths(out).filter(
					(path) =>
						/\.(?:js|css)$/.test(path) ||
						/^assets\/(?:favicon-|coast-110m\.bin-|rivers-50m\.bin-|title-map-|2022-)/.test(
							path,
						),
				);
				const shell = [
					"index.html",
					...files,
					"assets/images/title-map.svg",
					"assets/images/favicon.svg",
					"assets/atlas/coast-110m.bin.gz",
				];
				let worker = readFileSync(
					resolve(root, "workers/service-worker.js"),
					"utf8",
				);
				worker = worker.replace(
					/const APP_SHELL_PATHS\s*=\s*\[[\s\S]*?\];/,
					`const APP_SHELL_PATHS = ${JSON.stringify(shell, null, 2)};`,
				);
				// Different dev builds need separate shell caches even at the same version.
				const fingerprint = createHash("sha256").update(worker);
				for (const entry of [...shell].sort())
					fingerprint.update(entry).update(readFileSync(resolve(out, entry)));
				if (worker.split("__MW_CACHE_VERSION__").length !== 2)
					throw new Error("Expected one service-worker cache placeholder");
				worker = worker.replace(
					"__MW_CACHE_VERSION__",
					`mw-v${appVersion}-${fingerprint.digest("hex").slice(0, 12)}`,
				);
				writeFileSync(resolve(out, "service-worker.js"), worker);
				writeFileSync(
					resolve(out, "offline-manifest.json"),
					JSON.stringify(shell, null, 2),
				);
				for (const entry of shell)
					if (!existsSync(resolve(out, entry)))
						throw new Error(`Missing offline asset ${entry}`);
				// Worker imports are bundled separately by Vite; never cache source-only URLs.
				if (!existsSync(resolve(out, "index.html")))
					throw new Error("Missing build entry");
			},
		},
	],
});
