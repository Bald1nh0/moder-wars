import assert from "node:assert/strict";
import { captureSimulationState } from "../src/simulation-protocol.js";
import {
	decodeSimulationMessage,
	encodeSimulationMessage,
} from "../src/simulation-wire.js";
import { createTinySimulationState } from "./simulation-fixture.mjs";

const roundtrip = (value) =>
	decodeSimulationMessage(encodeSimulationMessage(value));
const buffer = new ArrayBuffer(40);
const bytes = new Uint8Array(buffer);
bytes.set([10, 20, 30, 40]);
const shared = { marker: "same" };
const sparse = new Array(17);
sparse[4] = undefined;
sparse[10] = shared;
sparse.note = shared;
const graph = {
	buffer,
	bytes,
	offsetView: new Uint16Array(buffer, 4, 9),
	dataView: new DataView(buffer, 3, 10),
	shared,
	other: shared,
	sparse,
	map: new Map([
		[shared, bytes],
		[bytes, shared],
	]),
	set: new Set([shared, bytes]),
	date: new Date("2026-01-01T00:00:00Z"),
	invalidDate: new Date(Number.NaN),
	values: [
		undefined,
		null,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		-0,
		10n,
		"Україна",
	],
	nullPrototype: Object.assign(Object.create(null), { field: "kept" }),
};
graph.self = graph;
graph.map.set(graph.map, graph);
Object.defineProperty(graph, "__proto__", {
	value: { polluted: true },
	enumerable: true,
});
const restored = roundtrip(graph);
assert.deepEqual(restored, graph);
assert.strictEqual(restored.self, restored);
assert.strictEqual(restored.shared, restored.other);
assert.strictEqual(restored.bytes.buffer, restored.buffer);
assert.strictEqual(restored.offsetView.buffer, restored.buffer);
assert.strictEqual(restored.dataView.buffer, restored.buffer);
assert.strictEqual(restored.map.get(restored.map), restored);
assert.strictEqual(restored.map.get(restored.shared), restored.bytes);
assert.equal(0 in restored.sparse, false);
assert.equal(4 in restored.sparse, true);
assert.strictEqual(restored.sparse[10], restored.shared);
assert.strictEqual(restored.sparse.note, restored.shared);
assert.equal(Object.getPrototypeOf(restored), Object.prototype);
assert.equal({}.polluted, undefined);
assert.equal(Object.getPrototypeOf(restored.nullPrototype), null);
bytes[0] = 99;
assert.equal(restored.bytes[0], 10, "decoded buffers own their storage");

for (const Type of [
	Int8Array,
	Uint8Array,
	Uint8ClampedArray,
	Int16Array,
	Uint16Array,
	Int32Array,
	Uint32Array,
	Float32Array,
	Float64Array,
	BigInt64Array,
	BigUint64Array,
]) {
	const value = new Type(5);
	value[2] = Type.name.startsWith("Big") ? 17n : 17;
	assert.deepEqual(roundtrip(value), value);
}
const sharedMemory = new SharedArrayBuffer(8);
new Uint8Array(sharedMemory)[2] = 72;
const sharedCopy = roundtrip({
	sharedMemory,
	view: new Uint8Array(sharedMemory),
});
assert.ok(sharedCopy.sharedMemory instanceof ArrayBuffer);
assert.strictEqual(sharedCopy.view.buffer, sharedCopy.sharedMemory);
assert.equal(sharedCopy.view[2], 72);

const initial = captureSimulationState(createTinySimulationState());
const message = { type: "INIT", epoch: 7, version: 2, state: initial };
assert.deepEqual(
	roundtrip(message),
	message,
	"actual captured simulation state survives transport",
);
const packet = encodeSimulationMessage(message);
const padded = new Uint8Array(packet.length + 11);
padded.set(packet, 5);
assert.deepEqual(
	decodeSimulationMessage(padded.subarray(5, 5 + packet.length)),
	message,
);
assert.deepEqual(decodeSimulationMessage(Buffer.from(packet)), message);
assert.deepEqual(decodeSimulationMessage(packet.buffer), message);
const large = new Uint8Array(8 * 1024 * 1024);
const largePacket = encodeSimulationMessage({
	large,
	alias: large,
	view: new DataView(large.buffer),
});
assert.ok(
	largePacket.length < large.length + 1024,
	"binary buffers are emitted once without base64 or numeric JSON expansion",
);

function corruptMetadata(packet, mutate) {
	const header = new DataView(
		packet.buffer,
		packet.byteOffset,
		packet.byteLength,
	);
	const metadataBytes = header.getUint32(4, true);
	const envelope = JSON.parse(
		new TextDecoder().decode(packet.subarray(12, 12 + metadataBytes)),
	);
	mutate(envelope);
	const metadata = new TextEncoder().encode(JSON.stringify(envelope));
	const result = new Uint8Array(
		12 + metadata.length + packet.length - 12 - metadataBytes,
	);
	result.set(packet.subarray(0, 12));
	new DataView(result.buffer).setUint32(4, metadata.length, true);
	result.set(metadata, 12);
	result.set(packet.subarray(12 + metadataBytes), 12 + metadata.length);
	return result;
}
const simple = encodeSimulationMessage({ value: 1 });
const viewPacket = encodeSimulationMessage(new Uint16Array(4));
for (const input of [
	new Uint8Array(),
	simple.subarray(0, 11),
	simple.subarray(0, simple.length - 1),
	new Uint8Array(simple.length),
	new Uint8Array([...simple, 0]),
	corruptMetadata(simple, (graph) => {
		graph[0] = ["r", 999999];
	}),
	corruptMetadata(simple, (graph) => {
		graph[1][0][0] = "EvilClass";
	}),
	corruptMetadata(simple, (graph) => {
		graph[1][0][2][0][1] = ["unknown"];
	}),
	corruptMetadata(simple, (graph) => {
		graph[1][0][2].push(graph[1][0][2][0]);
	}),
	corruptMetadata(viewPacket, (graph) => {
		graph[1][0][1] = "Function";
	}),
	corruptMetadata(viewPacket, (graph) => {
		graph[1][0][3] = 1;
	}),
	corruptMetadata(viewPacket, (graph) => {
		graph[1][0][4] = 20;
	}),
	corruptMetadata(viewPacket, (graph) => {
		graph[1][0][2] = ["r", 0];
	}),
	corruptMetadata(viewPacket, (graph) => {
		graph[1][1][1] = 1;
	}),
	corruptMetadata(encodeSimulationMessage([1]), (graph) => {
		graph[1][0][1] = 0;
	}),
])
	assert.throws(() => decodeSimulationMessage(input));
assert.throws(() => decodeSimulationMessage("not binary"));
assert.throws(() => encodeSimulationMessage(() => {}));
assert.throws(() => encodeSimulationMessage(/x/));
console.log(
	`Simulation binary graph codec passed (fixture ${packet.length} bytes; binary grid ${largePacket.length} bytes).`,
);
