import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Worker } from "node:worker_threads";
import { initializeCampaign } from "../src/campaign-core.js";
import { createSimulationClient } from "../src/simulation-client.js";
import { createSimulationCore } from "../src/simulation-core.js";
import { createSimulationMetrics } from "../src/simulation-metrics.js";
import {
	captureSimulationState,
	createControlDeltaTracker,
	createPresentationSnapshot,
	createPresentationSnapshotCache,
	packPresentationUnits,
	unpackPresentationUnits,
} from "../src/simulation-protocol.js";
import { createSimulationState } from "../src/simulation-state.js";
import { createTinySimulationState } from "./simulation-fixture.mjs";

function campaignFixture() {
	const state = createSimulationState(
		createTinySimulationState({ paused: true }),
	);
	state.perf = createSimulationMetrics();
	initializeCampaign(state);
	for (const country of Object.values(state.campaign.countries))
		country.automation = false;
	state.campaign.regions = {
		version: 1,
		gridWidth: state.gridWidth,
		gridHeight: state.gridHeight,
		cursor: 0,
		regions: [
			{
				id: "test",
				names: { en: "Test" },
				cells: [0, 1, 2],
				cursor: 0,
				counts: {},
				summary: null,
				candidate: null,
			},
		],
	};
	state.campaign.eventBaseline = {
		lastTick: 0,
		cities: {},
		countries: {},
		cityCursor: 0,
	};
	return state;
}
const state = campaignFixture();
state.units.forEach((unit, index) => {
	unit.campaignRole = ["infantry", "armor", "artillery", "airDefense"][index];
});
assert.deepEqual(
	unpackPresentationUnits(packPresentationUnits(state.units)).map(
		(unit) => unit.campaignRole,
	),
	state.units.map((unit) => unit.campaignRole),
);
const snapshot = createPresentationSnapshot(
	state,
	createControlDeltaTracker(state),
);
assert.equal(snapshot.values.campaign.eventBaseline, undefined);
assert.equal(
	snapshot.values.campaign.regions.regions[0].cells,
	undefined,
	"region membership is owner-only",
);
assert.deepEqual(
	captureSimulationState(state).campaign.regions.regions[0].cells,
	[0, 1, 2],
	"handoff preserves membership",
);
const cache = createPresentationSnapshotCache();
const tracker = createControlDeltaTracker(state);
createPresentationSnapshot(state, tracker, { cache });
state.campaign.countries[1].reserve--;
state._simTickCount++;
assert.equal(
	createPresentationSnapshot(state, tracker, { cache }).values.campaign,
	undefined,
	"reserve changes do not retransmit the economy each frame",
);
state._simTickCount += 60;
assert.ok(
	createPresentationSnapshot(state, tracker, { cache }).values.campaign,
);
state.campaign.countries[1].reserve--;
state.campaign.commandRevision = 1;
assert.ok(
	createPresentationSnapshot(state, tracker, { cache }).values.campaign,
	"commands bypass the periodic presentation budget",
);
const core = createSimulationCore(captureSimulationState(state));
const before = core.state.campaign.countries[1].treasury;
assert.deepEqual(
	core.command({
		type: "campaign",
		action: "train",
		countryId: 999,
		role: "armor",
	}),
	{ ok: false, reason: "invalid_country" },
);
assert.equal(core.state.campaign.countries[1].treasury, before);
assert.equal(
	core.command({
		type: "campaign",
		action: "train",
		countryId: 1,
		role: "infantry",
	}).ok,
	true,
);
assert.equal(core.state.campaign.countries[1].queue.length, 1);

const finishedCore = createSimulationCore(
	captureSimulationState(campaignFixture()),
);
finishedCore.command({ type: "APPLY_TREATY", treatyType: "WHITE_PEACE" });
assert.equal(finishedCore.state.campaign.finished, true);
assert.equal(finishedCore.state.campaign.finalForces[1].formations, 2);
assert.equal(finishedCore.state.campaign.finalForces[1].personnel, 2000);
assert.equal(
	finishedCore.state.campaign.events.filter(
		(event) => event.type === "peace_signed",
	).length,
	1,
);
finishedCore.command({ type: "APPLY_TREATY", treatyType: "WHITE_PEACE" });
assert.equal(
	finishedCore.state.campaign.events.filter(
		(event) => event.type === "peace_signed",
	).length,
	1,
);

// Exercise the actual worker and the same command/ACK protocol used remotely.
const workerUrl = new URL(
	"../workers/war-simulation-worker.js",
	import.meta.url,
).href;
const adapter = `import { parentPort } from "node:worker_threads";
globalThis.self = { postMessage: (message, transfers) => parentPort.postMessage(message, transfers) };
await import(${JSON.stringify(workerUrl)});
parentPort.on("message", data => self.onmessage({ data }));`;
const mirror = campaignFixture();
const runtime = {};
for (const key of Object.keys(mirror))
	Object.defineProperty(runtime, key, {
		get: () => mirror[key],
		set: (value) => {
			mirror[key] = value;
		},
		enumerable: true,
	});
let worker;
const client = createSimulationClient(runtime, {
	workerFactory: () => {
		worker = new Worker(
			new URL(`data:text/javascript,${encodeURIComponent(adapter)}`),
		);
		const transport = {
			postMessage: (...args) => worker.postMessage(...args),
			terminate: () => worker.terminate(),
		};
		worker.on("message", (data) => transport.onmessage?.({ data }));
		worker.on("error", (error) => transport.onerror?.(error));
		return transport;
	},
});
try {
	await client.start();
	assert.equal(client.diagnostics.owner, "worker");
	const funds = runtime.campaign.countries[1].treasury;
	const result = await client.command({
		type: "campaign",
		action: "train",
		countryId: 1,
		role: "infantry",
	});
	assert.equal(result.ok, true);
	for (
		let attempt = 0;
		attempt < 100 && runtime.campaign.countries[1].queue.length !== 1;
		attempt++
	)
		await delay(10);
	assert.equal(
		runtime.campaign.countries[1].queue.length,
		1,
		"paused worker publishes command mutations despite snapshot backpressure",
	);
	assert.equal(runtime.campaign.countries[1].treasury, funds - 120);
	assert.equal(
		(
			await client.command({
				type: "campaign",
				action: "train",
				countryId: 1,
				role: "invalid",
			})
		).ok,
		false,
	);
	await client.suspend();
	assert.equal(runtime.campaign.countries[1].queue.length, 1);
	assert.deepEqual(runtime.campaign.regions.regions[0].cells, [0, 1, 2]);
	assert.ok(
		runtime.campaign.eventBaseline,
		"full state survives editing handoff",
	);
	await client.start();
	assert.equal(
		(
			await client.command({
				type: "campaign",
				action: "policy",
				countryId: 1,
				policy: "defense",
			})
		).ok,
		true,
	);
	await client.suspend();
	assert.equal(runtime.campaign.countries[1].policy, "defense");
	assert.equal(
		runtime.campaign.countries[1].queue.length,
		1,
		"resuming does not initialize the economy again",
	);
} finally {
	client.stop();
	await worker?.terminate();
}
console.log(
	"Campaign integration smoke passed: owner commands, paused ACKs, roles, compact snapshots and handoffs.",
);
