import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createSimulationClient } from "../src/simulation-client.js";
import { createSimulationMetrics } from "../src/simulation-metrics.js";
import { packPresentationUnits } from "../src/simulation-protocol.js";
import { createSimulationState } from "../src/simulation-state.js";
import { createTinySimulationState } from "./simulation-fixture.mjs";

class Transport {
	constructor({ autoReady = true, autoHandoff = true } = {}) {
		this.autoReady = autoReady;
		this.autoHandoff = autoHandoff;
	}
	postMessage(message, transfer = []) {
		const copy = structuredClone(message, { transfer });
		if (copy.type === "INIT") {
			this.state = copy.state;
			this.epoch = copy.epoch;
			if (this.autoReady) queueMicrotask(() => this.emit("READY"));
		} else if (copy.type === "HANDOFF" && this.autoHandoff) {
			queueMicrotask(() =>
				this.emit("HANDOFF", {
					requestId: copy.requestId,
					state: structuredClone(this.state),
				}),
			);
		}
	}
	emit(type, fields = {}) {
		this.onmessage?.({ data: { type, epoch: this.epoch, ...fields } });
	}
	publish(tick, omitTick = false) {
		this.state._simTickCount = tick;
		this.emit("SNAPSHOT", {
			snapshot: {
				values: omitTick ? {} : { _simTickCount: tick },
				units: packPresentationUnits(this.state.units),
				tiles: [],
				metrics: {},
			},
		});
	}
	terminate() {}
}

function harness(options = {}, transportOptions = {}) {
	const runtime = createSimulationState(
		createTinySimulationState({ paused: true }),
	);
	runtime.perf = createSimulationMetrics();
	const transports = [];
	const client = createSimulationClient(runtime, {
		workerFactory: () => {
			const transport = new Transport(transportOptions);
			transports.push(transport);
			return transport;
		},
		...options,
	});
	return { client, runtime, transports };
}

{
	const { client, transports } = harness({}, { autoReady: false });
	assert.deepEqual(client.diagnostics, {
		requestedOwner: "browser",
		owner: null,
		status: "idle",
		startupMs: null,
		snapshots: 0,
		lastTick: 0,
		error: null,
		fallbackReason: null,
	});
	const starting = client.start();
	assert.equal(client.diagnostics.status, "starting");
	assert.equal(client.diagnostics.owner, null, "construction is not readiness");
	assert.equal(client.diagnostics.startupMs, null);
	transports[0].publish(3);
	assert.equal(client.diagnostics.status, "starting", "a frame is not READY");
	transports[0].emit("READY");
	await starting;
	assert.equal(client.diagnostics.owner, "worker");
	assert.equal(client.diagnostics.status, "ready");
	assert.ok(client.diagnostics.startupMs >= 0);
	transports[0].publish(17);
	transports[0].publish(17, true);
	assert.equal(client.diagnostics.snapshots, 3);
	assert.equal(
		client.diagnostics.lastTick,
		17,
		"omitted values retain last tick",
	);
	const report = client.diagnostics;
	report.owner = "server";
	assert.equal(
		client.diagnostics.owner,
		"worker",
		"reports cannot mutate owner",
	);
	await client.suspend();
	assert.equal(client.diagnostics.status, "suspended");
	assert.equal(client.diagnostics.owner, null);
	const restarted = client.start();
	transports[1].emit("READY");
	await restarted;
	assert.equal(client.diagnostics.snapshots, 0, "new owner resets counters");
	assert.equal(client.diagnostics.status, "ready");
	client.stop();
	transports[1].onerror(new Error("late closed-worker error"));
	transports[1].publish(999);
	assert.equal(client.diagnostics.status, "idle");
	assert.equal(client.diagnostics.snapshots, 0, "stale snapshots are ignored");
}

{
	const { client } = harness({
		workerFactory: () => {
			throw new Error("worker loading failed");
		},
	});
	try {
		await client.start();
		assert.equal(client.diagnostics.requestedOwner, "browser");
		assert.equal(client.diagnostics.owner, "main-thread");
		assert.equal(client.diagnostics.status, "ready");
		assert.equal(client.diagnostics.fallbackReason, "worker loading failed");
		assert.equal(client.diagnostics.error, null);
		await delay(100);
		assert.ok(client.diagnostics.snapshots > 0, "real local core publishes");
		await client.suspend();
		assert.equal(client.diagnostics.status, "suspended");
	} finally {
		client.stop();
	}
}

{
	const { client, transports } = harness();
	try {
		await client.start();
		transports[0].emit("ERROR", {
			message: "worker failed with recoverable state",
			state: structuredClone(transports[0].state),
		});
		assert.equal(client.diagnostics.owner, "main-thread");
		assert.match(client.diagnostics.fallbackReason, /recoverable state/);
		assert.equal(client.diagnostics.status, "ready");
	} finally {
		client.stop();
	}
}

for (const failByMessage of [true, false]) {
	const { client, transports } = harness({ allowLocalFallback: false });
	await client.start();
	assert.equal(client.diagnostics.requestedOwner, "server");
	assert.equal(client.diagnostics.owner, "server");
	transports[0].publish(4);
	if (failByMessage)
		transports[0].emit("ERROR", { message: "remote owner crashed" });
	else transports[0].onerror(new Error("connection lost"));
	assert.equal(client.diagnostics.status, "error");
	assert.equal(client.diagnostics.owner, null, "disconnected is not ready");
	assert.ok(client.diagnostics.error);
	assert.equal(client.diagnostics.fallbackReason, null);
	assert.equal(client.diagnostics.snapshots, 1);
	assert.equal(client.diagnostics.lastTick, 4);
	client.stop();
}

{
	const { client, transports } = harness();
	await client.start();
	transports[0].onerror(new Error("browser worker died without full state"));
	assert.equal(client.diagnostics.status, "error");
	assert.equal(client.diagnostics.owner, null);
	assert.equal(client.diagnostics.fallbackReason, null);
	assert.match(client.diagnostics.error, /without full state/);
	client.stop();
}

{
	const { client } = harness(
		{ allowLocalFallback: false, startupTimeoutMs: 10 },
		{ autoReady: false },
	);
	await client.start();
	assert.equal(client.diagnostics.status, "error");
	assert.equal(client.diagnostics.startupMs, null);
	assert.equal(client.diagnostics.owner, null);
	assert.match(client.diagnostics.error, /did not initialize/);
	client.stop();
}

{
	const { client } = harness(
		{ allowLocalFallback: false, handoffTimeoutMs: 10 },
		{ autoHandoff: false },
	);
	await client.start();
	await assert.rejects(client.suspend(), /handoff timed out/);
	assert.equal(client.diagnostics.status, "error");
	assert.equal(client.diagnostics.owner, null);
	client.stop();
}

{
	const { client } = harness(
		{ allowLocalFallback: false },
		{ autoHandoff: false },
	);
	await client.start();
	const pending = client.suspend();
	client.stop();
	await assert.rejects(pending, /stopped during handoff/);
	assert.equal(
		client.diagnostics.status,
		"idle",
		"cancelled handoff stays stopped",
	);
}

console.log(
	"Simulation owner diagnostics: readiness, snapshots, local fallback, recovery, remote failure, timeouts, handoff, reset, and stale messages passed.",
);
