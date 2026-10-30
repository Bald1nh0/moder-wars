import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Worker } from "node:worker_threads";
import { WebSocket } from "ws";
import { createSimulationServer } from "../server/index.mjs";
import { SIMULATION_PROTOCOL_VERSION } from "../src/simulation-protocol.js";
import {
	decodeSimulationMessage,
	encodeSimulationMessage,
} from "../src/simulation-wire.js";
import { createTinySimulationState } from "./simulation-fixture.mjs";

const directory = await mkdtemp(join(tmpdir(), "mw-server-smoke-"));
await writeFile(
	join(directory, "index.html"),
	"<title>Isolated prototype</title>",
);
await symlink("/etc/hostname", join(directory, "escape.txt"));
const app = await createSimulationServer({
	staticDir: directory,
	logger: { warn() {} },
});
const address = await app.listen(0);
const origin = `http://127.0.0.1:${address.port}`;
const url = `ws://127.0.0.1:${address.port}/simulation`;
const sockets = [];

async function connect() {
	const socket = new WebSocket(url, { origin });
	sockets.push(socket);
	const inbox = [];
	let failure;
	socket.on("message", (bytes) => {
		try {
			inbox.push(decodeSimulationMessage(bytes));
		} catch (error) {
			failure = error;
		}
	});
	socket.on("error", (error) => {
		failure = error;
	});
	await new Promise((resolve, reject) => {
		socket.once("open", resolve);
		socket.once("error", reject);
	});
	return {
		socket,
		inbox,
		send(type, fields = {}) {
			socket.send(encodeSimulationMessage({ type, epoch: 1, ...fields }));
		},
		async wait(type) {
			const deadline = Date.now() + 5000;
			while (Date.now() < deadline) {
				if (failure) throw failure;
				const index = inbox.findIndex((message) => message.type === type);
				if (index >= 0) return inbox.splice(index, 1)[0];
				const error = inbox.find((message) => message.type === "ERROR");
				if (error) throw new Error(error.message);
				await delay(5);
			}
			throw new Error(`Timed out waiting for ${type}`);
		},
	};
}
async function rejected(status, customOrigin = origin) {
	const socket = new WebSocket(url, { origin: customOrigin });
	socket.on("error", () => {});
	await new Promise((resolve, reject) => {
		socket.once("open", () => {
			socket.terminate();
			reject(new Error("Unexpected upgrade"));
		});
		socket.once("unexpected-response", (_request, response) => {
			assert.equal(response.statusCode, status);
			response.resume();
			socket.terminate();
			resolve();
		});
	});
}
async function until(predicate) {
	const deadline = Date.now() + 5000;
	while (!predicate()) {
		assert.ok(Date.now() < deadline, "Condition timed out");
		await delay(10);
	}
}

async function checkBacklogScheduler() {
	const schedulerUrl = new URL(
		"../server/worker-scheduler.mjs",
		import.meta.url,
	).href;
	const code = `import { parentPort } from "node:worker_threads";
		import { installWorkerScheduler } from ${JSON.stringify(schedulerUrl)};
		installWorkerScheduler();
		const channel = new MessageChannel();
		let turns = 0;
		channel.port1.onmessage = () => {
			const start = performance.now();
			while (performance.now() - start < 5) {}
			if (++turns < 200) channel.port2.postMessage(0);
		};
		parentPort.on("message", () => parentPort.postMessage({ turns }));
		parentPort.postMessage("ready");
		channel.port2.postMessage(0);`;
	const worker = new Worker(
		new URL(`data:text/javascript,${encodeURIComponent(code)}`),
	);
	try {
		const turns = await new Promise((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error("Backlog starved parent messages")),
				5000,
			);
			worker.on("error", (error) => {
				clearTimeout(timeout);
				reject(error);
			});
			worker.on("message", (message) => {
				if (message === "ready")
					setTimeout(() => worker.postMessage("control"), 25);
				else {
					clearTimeout(timeout);
					resolve(message.turns);
				}
			});
		});
		assert.ok(
			turns < 200,
			"parent commands are processed before a sustained self-post backlog ends",
		);
	} finally {
		await worker.terminate();
	}
}

try {
	await checkBacklogScheduler();
	assert.match(await (await fetch(origin)).text(), /Isolated prototype/);
	assert.equal(
		(await fetch(`${origin}/escape.txt`)).status,
		403,
		"static symlinks cannot escape the build",
	);
	assert.equal((await fetch(`${origin}/.env`)).status, 403);
	assert.equal((await fetch(origin, { method: "POST" })).status, 405);
	await rejected(403, "https://unrelated.example");
	const first = await connect();
	const second = await connect();
	await rejected(503);
	first.send("INIT", {
		version: SIMULATION_PROTOCOL_VERSION,
		state: createTinySimulationState(),
	});
	second.send("INIT", {
		version: SIMULATION_PROTOCOL_VERSION,
		state: createTinySimulationState({ paused: true, idOffset: 100 }),
	});
	await Promise.all([first.wait("READY"), second.wait("READY")]);
	const firstSnapshot = (await first.wait("SNAPSHOT")).snapshot;
	const secondSnapshot = (await second.wait("SNAPSHOT")).snapshot;
	assert.equal(firstSnapshot.units.numbers[0], 1);
	assert.equal(
		secondSnapshot.units.numbers[0],
		101,
		"sessions keep their own formations",
	);
	const streamStart = Date.now();
	let streamedSnapshots = 0;
	let streamedTick = firstSnapshot.values._simTickCount;
	while (Date.now() - streamStart < 500) {
		first.send("ACK");
		const snapshot = (await first.wait("SNAPSHOT")).snapshot;
		streamedSnapshots++;
		streamedTick = snapshot.values._simTickCount ?? streamedTick;
	}
	assert.ok(
		streamedSnapshots >= 3,
		"ordinary ACKs sustain automatic snapshot publication",
	);
	assert.ok(
		streamedTick > firstSnapshot.values._simTickCount,
		"automatic snapshots expose advancing ticks without forced requests",
	);
	await delay(250);
	assert.equal(
		first.inbox.filter((item) => item.type === "SNAPSHOT").length,
		0,
		"snapshot ACK gates outbound frames",
	);
	first.send("CONTROL", { paused: true, speed: 1 });
	first.send("ACK", { requestSnapshot: true });
	const paused = (await first.wait("SNAPSHOT")).snapshot.values._simTickCount;
	assert.ok(paused > 0, "owner advances without client presentation ACKs");
	await delay(100);
	first.send("ACK", { requestSnapshot: true });
	assert.equal(
		(await first.wait("SNAPSHOT")).snapshot.values._simTickCount ?? paused,
		paused,
	);
	second.send("ACK", { requestSnapshot: true });
	assert.equal(
		(await second.wait("SNAPSHOT")).snapshot.values._simTickCount ?? 0,
		0,
		"first session controls cannot resume second",
	);
	first.send("CONTROL", { paused: false, speed: 1 });
	await delay(220);
	first.send("CONTROL", { paused: true });
	first.send("ACK", { requestSnapshot: true });
	const slowTick = (await first.wait("SNAPSHOT")).snapshot.values._simTickCount;
	first.send("CONTROL", { paused: false, speed: 5 });
	await delay(220);
	first.send("CONTROL", { paused: true });
	first.send("ACK", { requestSnapshot: true });
	const fastTick = (await first.wait("SNAPSHOT")).snapshot.values._simTickCount;
	assert.ok(
		fastTick - slowTick > slowTick - paused,
		"speed control accelerates the server clock",
	);
	first.send("HANDOFF", { requestId: 42 });
	const handoff = await first.wait("HANDOFF");
	assert.equal(handoff.requestId, 42);
	assert.equal(handoff.state.units[0].smokeMarker, "formation-1");
	assert.ok(
		handoff.state.sideInfluenceMaps.every((map) => map instanceof Float32Array),
	);
	const health = await (await fetch(`${origin}/health`)).json();
	assert.equal(health.sessions, 2);
	assert.equal(health.ready, 2);
	assert.ok(health.receivedBytes > 0 && health.sentBytes > 0);
	const closed = new Promise((resolve) => first.socket.once("close", resolve));
	first.socket.close();
	await closed;
	const replacement = await connect();
	replacement.send("INIT", {
		version: SIMULATION_PROTOCOL_VERSION,
		state: handoff.state,
	});
	await replacement.wait("READY");
	assert.equal(
		app.sessionCount,
		2,
		"closed owner can be replaced while the other slot stays occupied",
	);
	replacement.socket.close();
	second.socket.close();
	await until(() => app.sessionCount === 0);
	const overloaded = await connect();
	overloaded.send("INIT", {
		version: SIMULATION_PROTOCOL_VERSION,
		state: createTinySimulationState({ speed: 100 }),
	});
	await overloaded.wait("READY");
	let busyTick = 0;
	for (let count = 0; count < 5; count++) {
		const snapshot = (await overloaded.wait("SNAPSHOT")).snapshot;
		busyTick = snapshot.values._simTickCount ?? busyTick;
		overloaded.send("ACK");
	}
	assert.ok(
		busyTick > 0,
		"ordinary ACKs sustain snapshots under an accelerated workload",
	);
	overloaded.send("CONTROL", { paused: true });
	overloaded.send("HANDOFF", { requestId: 101 });
	assert.equal(
		(await overloaded.wait("HANDOFF")).state.isPaused,
		true,
		"pause and ownership handoff remain responsive under backlog",
	);
	overloaded.socket.close();
	await until(() => app.sessionCount === 0);
	const invalid = await connect();
	invalid.socket.send(Buffer.from("malformed"));
	await until(() => invalid.socket.readyState === WebSocket.CLOSED);
	await until(() => app.sessionCount === 0);
	console.log(
		"Server simulation: static containment, origin/capacity, isolated sessions, READY/snapshots, ACK backpressure, pause/speed, full handoff, malformed input and disconnect cleanup passed.",
	);
} finally {
	for (const socket of sockets) socket.terminate();
	await app.close();
	await rm(directory, { recursive: true, force: true });
}
