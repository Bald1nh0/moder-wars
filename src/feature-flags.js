const PERFORMANCE_TEST_KEY = "mw.feature.performanceTest";
const SERVER_SIMULATION_KEY = "mw.feature.serverSimulation";

/** Explicit test links override the saved preference without changing it. */
export function getSimulationMode({
	storage = () => globalThis.localStorage,
	location = globalThis.location,
} = {}) {
	const override = new URLSearchParams(location?.search).get("simulation");
	if (override === "browser" || override === "server") return override;
	try {
		if (storage()?.getItem(SERVER_SIMULATION_KEY) === "true") return "server";
	} catch {}
	return "browser";
}

/** Changing the preference never migrates or restarts a live simulation. */
export function createSimulationModePreference({
	storage = () => globalThis.localStorage,
	location = globalThis.location,
	history = globalThis.history,
} = {}) {
	let mode = getSimulationMode({ storage, location });
	return {
		get mode() {
			return mode;
		},
		setServerEnabled(enabled) {
			mode = enabled ? "server" : "browser";
			try {
				storage()?.setItem(SERVER_SIMULATION_KEY, String(Boolean(enabled)));
			} catch {}
			// Keep reloads explicit even when storage is unavailable or a URL opted in.
			if (location?.href && history?.replaceState) {
				const url = new URL(location.href);
				url.searchParams.set("simulation", mode);
				history.replaceState(history.state, "", url);
			}
		},
	};
}

export function simulationGameUrl(href, mode) {
	const url = new URL(href);
	url.searchParams.delete("deviceTest");
	url.searchParams.set("simulation", mode === "server" ? "server" : "browser");
	return url.href;
}

/** Feature flags control optional UI, not server authorization. */
export function createFeatureFlags({
	storage = () => globalThis.localStorage,
	location = globalThis.location,
	history = globalThis.history,
	onChange = () => {},
} = {}) {
	let saved = false;
	try {
		saved = storage()?.getItem(PERFORMANCE_TEST_KEY) === "true";
	} catch {}
	const override = new URLSearchParams(location?.search).get("performanceTest");
	let enabled = override === "1" || (override !== "0" && saved);
	return {
		get performanceTest() {
			return enabled;
		},
		setPerformanceTest(value) {
			enabled = Boolean(value);
			try {
				storage()?.setItem(PERFORMANCE_TEST_KEY, String(enabled));
			} catch {}
			// The settings switch must override even a flag-enabled shared URL.
			if (location?.href && history?.replaceState) {
				const url = new URL(location.href);
				url.searchParams.delete("performanceTest");
				history.replaceState(history.state, "", url);
			}
			onChange(enabled);
		},
	};
}
