// Vite supplies this metadata from package.json for both dev and built pages.
export function getAppVersion(documentLike = globalThis.document) {
	const version = documentLike?.querySelector?.(
		'meta[name="application-version"]',
	)?.content;
	return typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version)
		? version
		: "development";
}

export function getAppVersionLabel(documentLike = globalThis.document) {
	const version = getAppVersion(documentLike);
	return version === "development" ? version : `v${version}`;
}

export function getAppBuildLabel(documentLike = globalThis.document) {
	return `Modern Wars ${getAppVersionLabel(documentLike)}`;
}
