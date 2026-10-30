import assert from "node:assert/strict";
import { deviceTestUrl } from "../src/device-performance-test.js";
import {
	createSimulationModePreference,
	getSimulationMode,
	simulationGameUrl,
} from "../src/feature-flags.js";
import { createRemoteSimulationOptions } from "../src/remote-simulation-worker.js";

const data = new Map();
const storage = () => ({
	getItem: (key) => data.get(key),
	setItem: (key, value) => data.set(key, value),
});
const location = new URL("https://game.example/sub/?performanceTest=1");
const history = {
	replaceState(_state, _title, url) {
		location.href = String(url);
	},
};
const options = { storage, location, history };
assert.equal(
	getSimulationMode(options),
	"browser",
	"fresh browser defaults local",
);
assert.deepEqual(createRemoteSimulationOptions("browser"), {});
const preference = createSimulationModePreference(options);
preference.setServerEnabled(true);
assert.equal(preference.mode, "server");
assert.equal(location.searchParams.get("simulation"), "server");
assert.equal(location.searchParams.get("performanceTest"), "1");
assert.equal(
	getSimulationMode({ storage, location: { search: "" } }),
	"server",
	"an explicit opt-in persists for later ordinary page loads",
);
for (const mode of ["browser", "server"]) {
	const url = new URL(deviceTestUrl(location.href, mode));
	assert.equal(getSimulationMode({ storage, location: url }), mode);
	assert.equal(url.pathname, "/sub/");
}
assert.equal(data.get("mw.feature.serverSimulation"), "true");
assert.equal(
	getSimulationMode({ storage, location: { search: "?simulation=browser" } }),
	"browser",
	"browser links must override a saved server preference",
);
preference.setServerEnabled(false);
assert.equal(preference.mode, "browser");
assert.equal(location.searchParams.get("simulation"), "browser");
assert.equal(
	getSimulationMode({ storage, location: { search: "" } }),
	"browser",
);
const unavailable = () => {
	throw new Error("storage disabled");
};
assert.equal(getSimulationMode({ storage: unavailable }), "browser");
assert.equal(
	getSimulationMode({
		storage: unavailable,
		location: { search: "?simulation=invalid" },
	}),
	"browser",
);
const explicit = new URL(
	"https://game.example/sub/?simulation=server&deviceTest=1",
);
const blocked = createSimulationModePreference({
	storage: unavailable,
	location: explicit,
	history: {
		replaceState: (_state, _title, url) => {
			explicit.href = String(url);
		},
	},
});
blocked.setServerEnabled(false);
assert.equal(
	getSimulationMode({ storage: unavailable, location: explicit }),
	"browser",
);
const newGame = new URL(simulationGameUrl(explicit.href, "server"));
assert.equal(newGame.searchParams.has("deviceTest"), false);
assert.equal(newGame.searchParams.get("simulation"), "server");
assert.equal(newGame.pathname, "/sub/");
assert.equal(
	data.has("mw.feature.performanceTest"),
	false,
	"flags stay independent",
);
console.log(
	"Simulation mode: browser default, persistence, explicit test overrides, storage failure and fresh game URLs passed.",
);
