import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { RemoteSimulationWorker } from "../src/remote-simulation-worker.js";
import { createSimulationClient } from "../src/simulation-client.js";
import { createSimulationState } from "../src/simulation-state.js";
import {
	decodeSimulationMessage,
	encodeSimulationMessage,
} from "../src/simulation-wire.js";
import { createTinySimulationState } from "./simulation-fixture.mjs";

class Socket {
	constructor() {
		this.readyState = 0;
		this.bufferedAmount = 0;
		this.sent = [];
	}
	send(packet) {
		this.sent.push(decodeSimulationMessage(packet));
	}
	close() {
		this.readyState = 3;
		this.onclose?.({ code: 1000, reason: "" });
	}
	open() {
		this.readyState = 1;
		this.extensions = "permessage-deflate";
		this.onopen();
	}
	receive(message) {
		this.onmessage({ data: encodeSimulationMessage(message).buffer });
	}
}
const statuses = [];
const transport = new RemoteSimulationWorker("ws://localhost/simulation", {
	WebSocketClass: Socket,
	onStatus: (state) => statuses.push(state.state),
});
let received;
let failures = 0;
transport.onmessage = ({ data }) => {
	received = data;
};
transport.onerror = () => failures++;
const initialView = new Uint16Array([1, 2]);
transport.postMessage({ type: "INIT", state: initialView }, [
	initialView.buffer,
]);
assert.equal(
	initialView.buffer.byteLength,
	0,
	"captured transfer buffers are detached after encoding",
);
transport.postMessage({ type: "CONTROL", paused: true });
assert.equal(transport.socket.sent.length, 0);
transport.socket.open();
assert.equal(transport.stats.extensions, "permessage-deflate");
assert.deepEqual(
	transport.socket.sent.map((message) => message.type),
	["INIT", "CONTROL"],
);
assert.deepEqual(transport.socket.sent[0].state, new Uint16Array([1, 2]));
transport.socket.receive({ type: "READY", epoch: 1 });
assert.equal(received.type, "READY");
assert.equal(transport.stats.state, "ready");
assert.ok(transport.stats.readyMs >= 0);
assert.ok(transport.stats.bytesSent > 0);
assert.ok(transport.stats.bytesReceived > 0);
transport.terminate();
assert.equal(failures, 0, "deliberate termination is not a network failure");
assert.deepEqual(statuses, ["connecting", "initializing", "ready", "idle"]);

const broken = new RemoteSimulationWorker("ws://localhost/simulation", {
	WebSocketClass: Socket,
});
broken.onerror = () => failures++;
broken.socket.close();
assert.equal(failures, 1);
assert.equal(broken.stats.state, "error");
assert.equal(broken.pending.length, 0);

function runtime() {
	return createSimulationState(createTinySimulationState({ paused: false }));
}
class FakeWorker {
	postMessage(message) {
		if (message.type === "INIT") {
			this.epoch = message.epoch;
			queueMicrotask(() =>
				this.onmessage({ data: { type: "READY", epoch: this.epoch } }),
			);
		}
	}
	terminate() {
		this.terminated = true;
	}
}
{
	const state = runtime();
	let failed;
	const client = createSimulationClient(state, {
		allowLocalFallback: false,
		workerFactory: () => {
			throw new Error("server unavailable");
		},
		onFailure: (error) => {
			failed = error;
		},
	});
	await client.start();
	assert.equal(failed.message, "server unavailable");
	assert.equal(client.active, false);
	assert.equal(state.isPaused, true);
	assert.equal(
		client.ownsState,
		true,
		"failed remote ownership prevents main-thread fallback",
	);
	state.isPaused = false;
	client.syncControls();
	assert.equal(
		state.isPaused,
		true,
		"unpause cannot start stale local simulation",
	);
	await assert.rejects(
		client.edit(() => assert.fail("must not mutate stale state")),
		/disconnected/,
	);
	client.stop();
	assert.equal(client.ownsState, false);
}
{
	const state = runtime();
	const worker = new FakeWorker();
	let failed;
	const client = createSimulationClient(state, {
		allowLocalFallback: false,
		workerFactory: () => worker,
		onFailure: (error) => {
			failed = error;
		},
	});
	await client.start();
	worker.onmessage({
		data: {
			type: "ERROR",
			epoch: worker.epoch,
			message: "owner crashed",
			state: runtime(),
		},
	});
	assert.equal(failed.message, "owner crashed");
	assert.equal(client.active, false);
	assert.equal(client.ownsState, true);
	assert.equal(
		state.isPaused,
		true,
		"remote owner error with state must not silently start a local owner",
	);
	client.stop();
}
{
	const state = runtime();
	const worker = new FakeWorker();
	const client = createSimulationClient(state, {
		allowLocalFallback: false,
		workerFactory: () => worker,
		handoffTimeoutMs: 20,
	});
	await client.start();
	await assert.rejects(client.suspend(), /handoff timed out/);
	assert.equal(worker.terminated, true);
	assert.equal(state.isPaused, true);
	client.stop();
}
{
	const state = runtime();
	const worker = { postMessage() {}, terminate() {} };
	const client = createSimulationClient(state, {
		allowLocalFallback: false,
		workerFactory: () => worker,
		startupTimeoutMs: 20,
	});
	await client.start();
	await delay(30);
	assert.equal(client.active, false);
	assert.equal(state.isPaused, true);
	client.stop();
}
// A full server must release the old socket before accepting an edited owner.
{
	const state = runtime();
	let created = 0;
	let releaseClose;
	let mutationRan = false;
	class DelayedCloseWorker extends FakeWorker {
		postMessage(message) {
			if (message.type === "INIT") this.state = structuredClone(message.state);
			if (message.type === "HANDOFF")
				queueMicrotask(() =>
					this.onmessage({
						data: {
							type: "HANDOFF",
							epoch: this.epoch,
							requestId: message.requestId,
							state: structuredClone(this.state),
							events: [],
						},
					}),
				);
			super.postMessage(message);
		}
		terminate() {
			if (!this.completion)
				this.completion = new Promise((resolve) => {
					releaseClose = resolve;
				});
			return this.completion;
		}
	}
	const client = createSimulationClient(state, {
		allowLocalFallback: false,
		workerFactory: () => {
			created++;
			return new DelayedCloseWorker();
		},
	});
	await client.start();
	const editing = client.edit(() => {
		mutationRan = true;
	});
	await delay(10);
	assert.equal(
		created,
		1,
		"replacement cannot race the old owner's socket close",
	);
	assert.equal(mutationRan, false);
	assert.equal(
		client.ownsState,
		true,
		"closing handoff keeps local frame ticks disabled",
	);
	releaseClose();
	await editing;
	assert.equal(mutationRan, true);
	assert.equal(created, 2);
	client.stop();
	releaseClose();
}
console.log(
	"Remote transport ordering, diagnostics, intentional close, connection failure, no local fallback, bounded startup/handoff, and awaited owner replacement passed.",
);
