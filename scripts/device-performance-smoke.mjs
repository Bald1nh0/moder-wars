import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import {
	comparableDeviceReports,
	createDeviceTestRunner,
	deviceTestUrl,
} from "../src/device-performance-test.js";
import { createFeatureFlags } from "../src/feature-flags.js";
import { createWarStart } from "../src/war-start.js";

const storage = new Map();
const adapter = {
	getItem: (key) => storage.get(key),
	setItem: (key, value) => storage.set(key, value),
};
const location = {
	href: "https://game.example/sub/?performanceTest=1&simulation=server",
	search: "?performanceTest=1&simulation=server",
};
let replaced;
const flags = createFeatureFlags({
	storage: () => adapter,
	location,
	history: {
		replaceState(_state, _title, url) {
			replaced = String(url);
		},
	},
});
assert.equal(flags.performanceTest, true);
flags.setPerformanceTest(false);
assert.equal(flags.performanceTest, false);
assert.equal(new URL(replaced).searchParams.has("performanceTest"), false);
assert.equal(new URL(replaced).searchParams.get("simulation"), "server");
assert.equal(
	createFeatureFlags({ storage: () => adapter }).performanceTest,
	false,
);
flags.setPerformanceTest(true);
assert.equal(
	createFeatureFlags({ storage: () => adapter }).performanceTest,
	true,
);
assert.equal(
	createFeatureFlags({
		storage: () => adapter,
		location: { search: "?performanceTest=0" },
	}).performanceTest,
	false,
);
assert.equal(
	createFeatureFlags({
		storage: () => {
			throw new Error("blocked storage");
		},
	}).performanceTest,
	false,
);
assert.equal(
	new URL(deviceTestUrl(location.href, "browser")).searchParams.get(
		"simulation",
	),
	"browser",
);
assert.equal(new URL(deviceTestUrl(location.href, "server")).pathname, "/sub/");

const goodReport = () => ({
	ticks: { count: 12, avgMs: 3, p95Ms: 5 },
	frames: { count: 20, avg: 17 },
	config: {
		gridRes: 0.1,
		mapResolution: "50m",
		simSpeed: 1,
		viewMode: "POLITICAL",
		unitCount: 240,
	},
	benchmark: {
		initialFormationCountBySide: [120, 120],
		initialPersonnelBySide: [120000, 120000],
	},
});
function fixture(overrides = {}) {
	let invalidation;
	let stopped = 0;
	let benchmarked = 0;
	let execution = { status: "ready", owner: "worker", startupMs: 12 };
	const runner = createDeviceTestRunner({
		prepare: async () => {},
		benchmark: async () => {
			benchmarked++;
			return goodReport();
		},
		stop() {
			stopped++;
			execution = { ...execution, status: "idle", owner: null };
		},
		readOwner: () => execution,
		readEnvironment: () => ({
			viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
			userAgent: "fixture",
		}),
		readSettings: () => ({ grid: 0.1 }),
		watch(callback) {
			invalidation = callback;
			return () => {
				invalidation = null;
			};
		},
		build: "test-build",
		...overrides,
	});
	return {
		runner,
		invalidate: (reason) => invalidation?.(reason),
		get stopped() {
			return stopped;
		},
		get benchmarked() {
			return benchmarked;
		},
	};
}
const normal = fixture();
const normalResult = await normal.runner.run();
assert.equal(normalResult.valid, true);
assert.equal(
	normalResult.execution.owner,
	"worker",
	"report captures owner before stopping",
);
assert.equal(normal.stopped, 1);
assert.equal(normal.runner.running, false);

for (const reason of ["hidden", "resized", "cancelled"]) {
	let finish;
	const loading = fixture({
		prepare: () =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	});
	const result = loading.runner.run();
	loading.invalidate(reason);
	assert.equal((await result).reason, reason);
	finish();
	await delay(0);
	assert.equal(
		loading.benchmarked,
		0,
		"late loader cannot start a cancelled benchmark",
	);
	assert.ok(loading.stopped >= 1);
}
const empty = fixture({
	benchmark: async () => ({ ...goodReport(), ticks: { count: 0 } }),
});
assert.equal((await empty.runner.run()).reason, "no_ticks");
const wrongMode = fixture({ mode: "server" });
assert.equal((await wrongMode.runner.run()).reason, "disconnected");
const wrongForces = fixture({
	benchmark: async () => ({
		...goodReport(),
		benchmark: { initialFormationCountBySide: [50, 50] },
	}),
});
assert.equal((await wrongForces.runner.run()).reason, "settings");
const timed = fixture({ prepare: () => new Promise(() => {}), timeoutMs: 10 });
assert.equal((await timed.runner.run()).reason, "timeout");
let finish;
const duplicate = fixture({
	prepare: () =>
		new Promise((resolve) => {
			finish = resolve;
		}),
});
const ongoing = duplicate.runner.run();
await assert.rejects(duplicate.runner.run(), /already running/);
duplicate.runner.cancel();
await ongoing;
finish();
const preparations = [];
const reuse = fixture({
	prepare: () => new Promise((resolve) => preparations.push(resolve)),
});
const oldRun = reuse.runner.run();
reuse.runner.cancel();
await oldRun;
const newRun = reuse.runner.run();
const stoppedBeforeOldLoaderReturns = reuse.stopped;
preparations[0]();
await delay(0);
assert.equal(
	reuse.stopped,
	stoppedBeforeOldLoaderReturns,
	"cancelled loader cannot stop a newer run",
);
reuse.runner.cancel();
await newRun;
preparations[1]();
const fallback = fixture({
	readOwner: () => ({
		status: "ready",
		owner: "main-thread",
		fallbackReason: "worker timeout",
	}),
});
assert.equal((await fallback.runner.run()).execution.owner, "main-thread");
const server = structuredClone(normalResult);
server.requestedOwner = "server";
server.execution.owner = "server";
assert.equal(comparableDeviceReports(normalResult, server), true);
server.report.config.unitCount = 252;
assert.equal(
	comparableDeviceReports(normalResult, server),
	true,
	"random later recruitment does not change initial workload signature",
);
server.report.benchmark.initialPersonnelBySide[0] = 1;
assert.equal(
	comparableDeviceReports(normalResult, server),
	false,
	"effective initial forces must match",
);
server.report = goodReport();
server.environment.viewport.width++;
assert.equal(comparableDeviceReports(normalResult, server), false);
server.environment = structuredClone(normalResult.environment);
server.valid = false;
assert.equal(comparableDeviceReports(normalResult, server), false);

// Cancel during the lifecycle's initial asynchronous delay: no war setup or owner may start later.
const controller = new AbortController();
let initialization = 0;
const war = createWarStart({
	sides: [[{ id: 1 }], [{ id: 2 }]],
	setLoadingThematic() {},
	loadingOverlay: { style: {} },
	loadingStatus: {},
	loadingBar: { style: {} },
	getTranslation: (value) => value,
	invalidateWarLifecycleTimers() {
		initialization++;
	},
	isCustomTerrain: true,
});
const start = war.startWar({ signal: controller.signal });
controller.abort(new Error("test cancelled"));
await assert.rejects(start, /test cancelled/);
assert.equal(initialization, 0);
console.log(
	"Device performance flags, fresh mode URLs, report ownership/workload compatibility, hidden/resize/cancel/timeout invalidation, duplicate starts, and asynchronous war-start cancellation passed.",
);
