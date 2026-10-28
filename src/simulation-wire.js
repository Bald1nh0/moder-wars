// The prototype wire keeps numeric grids binary and preserves graph identity.
const MAGIC = 0x3157534d; // MSW1, little-endian.
const HEADER_BYTES = 12;
export const SIMULATION_WIRE_MAX_BYTES = 512 * 1024 * 1024;
const MAX_METADATA_BYTES = 32 * 1024 * 1024;
const MAX_NODES = 1_000_000;
const MAX_ARRAY_LENGTH = 16_777_216;
const VIEW_TYPES = new Map(
	[
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
		DataView,
	].map((type) => [type.name, type]),
);
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
function invalid(reason) {
	throw new Error(`Invalid simulation wire message: ${reason}`);
}
function integer(value, maximum = SIMULATION_WIRE_MAX_BYTES) {
	return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
function isBuffer(value) {
	return (
		value instanceof ArrayBuffer ||
		(typeof SharedArrayBuffer !== "undefined" &&
			value instanceof SharedArrayBuffer)
	);
}

export function encodeSimulationMessage(value) {
	const ids = new Map();
	const objects = [];
	const nodes = [];
	const buffers = [];
	let rawBytes = 0;
	function token(item) {
		if (item === undefined) return ["u"];
		if (typeof item === "number") {
			if (Number.isNaN(item)) return ["n", "NaN"];
			if (!Number.isFinite(item)) return ["n", item > 0 ? "+Inf" : "-Inf"];
			if (Object.is(item, -0)) return ["n", "-0"];
			return item;
		}
		if (typeof item === "bigint") {
			const digits = item.toString();
			if (digits.length > 4096) invalid("bigint too large");
			return ["i", digits];
		}
		if (item === null || typeof item === "string" || typeof item === "boolean")
			return item;
		if (typeof item !== "object") invalid("unsupported value");
		if (!ids.has(item)) {
			if (objects.length >= MAX_NODES) invalid("too many nodes");
			ids.set(item, objects.length);
			objects.push(item);
		}
		return ["r", ids.get(item)];
	}
	const root = token(value);
	for (let index = 0; index < objects.length; index++) {
		const item = objects[index];
		let node;
		if (isBuffer(item)) {
			if (rawBytes + item.byteLength > SIMULATION_WIRE_MAX_BYTES)
				invalid("buffers too large");
			node = ["b", rawBytes, item.byteLength];
			buffers.push(new Uint8Array(item));
			rawBytes += item.byteLength;
		} else if (ArrayBuffer.isView(item)) {
			const type =
				item instanceof DataView ? "DataView" : item.constructor.name;
			if (!VIEW_TYPES.has(type)) invalid("unsupported view type");
			node = [
				"v",
				type,
				token(item.buffer),
				item.byteOffset,
				item instanceof DataView ? item.byteLength : item.length,
			];
		} else if (item instanceof Date) node = ["d", token(item.getTime())];
		else if (item instanceof Map)
			node = [
				"m",
				Array.from(item, ([key, entry]) => [token(key), token(entry)]),
			];
		else if (item instanceof Set) node = ["s", Array.from(item, token)];
		else if (Array.isArray(item)) {
			if (item.length > MAX_ARRAY_LENGTH) invalid("array too large");
			node = [
				"a",
				item.length,
				Object.keys(item).map((key) => [key, token(item[key])]),
			];
		} else {
			const prototype = Object.getPrototypeOf(item);
			if (prototype !== null && prototype !== Object.prototype)
				invalid("unsupported object prototype");
			node = [
				"o",
				prototype === null,
				Object.keys(item).map((key) => [key, token(item[key])]),
			];
		}
		nodes.push(node);
	}
	const metadata = encoder.encode(JSON.stringify([root, nodes]));
	if (metadata.byteLength > MAX_METADATA_BYTES) invalid("metadata too large");
	const totalBytes = HEADER_BYTES + metadata.byteLength + rawBytes;
	if (totalBytes > SIMULATION_WIRE_MAX_BYTES) invalid("message too large");
	const result = new Uint8Array(totalBytes);
	const header = new DataView(result.buffer);
	header.setUint32(0, MAGIC, true);
	header.setUint32(4, metadata.byteLength, true);
	header.setUint32(8, rawBytes, true);
	result.set(metadata, HEADER_BYTES);
	let offset = HEADER_BYTES + metadata.byteLength;
	for (const buffer of buffers) {
		result.set(buffer, offset);
		offset += buffer.byteLength;
	}
	return result;
}

export function decodeSimulationMessage(input) {
	if (!(input instanceof ArrayBuffer) && !ArrayBuffer.isView(input))
		invalid("expected binary input");
	const bytes =
		input instanceof ArrayBuffer
			? new Uint8Array(input)
			: new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	if (
		bytes.byteLength < HEADER_BYTES ||
		bytes.byteLength > SIMULATION_WIRE_MAX_BYTES
	)
		invalid("message size");
	const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (header.getUint32(0, true) !== MAGIC) invalid("magic/version");
	const metadataBytes = header.getUint32(4, true);
	const rawBytes = header.getUint32(8, true);
	if (
		metadataBytes > MAX_METADATA_BYTES ||
		HEADER_BYTES + metadataBytes + rawBytes !== bytes.byteLength
	)
		invalid("payload lengths");
	const envelope = JSON.parse(
		decoder.decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + metadataBytes)),
	);
	if (
		!Array.isArray(envelope) ||
		envelope.length !== 2 ||
		!Array.isArray(envelope[1]) ||
		envelope[1].length > MAX_NODES
	)
		invalid("graph envelope");
	const [root, nodes] = envelope;
	const values = new Array(nodes.length);
	const rawStart = HEADER_BYTES + metadataBytes;
	let consumedBytes = 0;
	function reference(item) {
		if (
			!Array.isArray(item) ||
			item.length !== 2 ||
			item[0] !== "r" ||
			!integer(item[1], nodes.length - 1)
		)
			invalid("reference");
		return item[1];
	}
	function token(item) {
		if (item === null || typeof item === "string" || typeof item === "boolean")
			return item;
		if (typeof item === "number" && Number.isFinite(item)) return item;
		if (!Array.isArray(item)) invalid("value token");
		if (item.length === 1 && item[0] === "u") return undefined;
		if (item[0] === "r") return values[reference(item)];
		if (item.length === 2 && item[0] === "n") {
			switch (item[1]) {
				case "NaN":
					return Number.NaN;
				case "+Inf":
					return Number.POSITIVE_INFINITY;
				case "-Inf":
					return Number.NEGATIVE_INFINITY;
				case "-0":
					return -0;
				default:
					invalid("number token");
			}
		}
		if (
			item.length === 2 &&
			item[0] === "i" &&
			typeof item[1] === "string" &&
			item[1].length <= 4096 &&
			/^-?\d+$/.test(item[1])
		)
			return BigInt(item[1]);
		invalid("value token");
	}
	for (let index = 0; index < nodes.length; index++) {
		const node = nodes[index];
		if (!Array.isArray(node)) invalid("node");
		switch (node[0]) {
			case "b": {
				if (
					node.length !== 3 ||
					node[1] !== consumedBytes ||
					!integer(node[2], rawBytes - consumedBytes)
				)
					invalid("buffer range");
				// Own each buffer: views share it, but never retain the full network frame.
				values[index] = bytes.slice(
					rawStart + node[1],
					rawStart + node[1] + node[2],
				).buffer;
				consumedBytes += node[2];
				break;
			}
			case "v":
				break;
			case "a":
				if (node.length !== 3 || !integer(node[1], MAX_ARRAY_LENGTH))
					invalid("array length");
				values[index] = new Array(node[1]);
				break;
			case "o":
				if (node.length !== 3 || typeof node[1] !== "boolean")
					invalid("object");
				values[index] = node[1] ? Object.create(null) : {};
				break;
			case "m":
				if (node.length !== 2) invalid("map");
				values[index] = new Map();
				break;
			case "s":
				if (node.length !== 2) invalid("set");
				values[index] = new Set();
				break;
			case "d":
				if (node.length !== 2) invalid("date");
				values[index] = new Date(Number.NaN);
				break;
			default:
				invalid("node type");
		}
	}
	if (consumedBytes !== rawBytes) invalid("unused binary data");
	for (let index = 0; index < nodes.length; index++) {
		const node = nodes[index];
		if (node[0] !== "v") continue;
		if (
			node.length !== 5 ||
			!VIEW_TYPES.has(node[1]) ||
			!integer(node[3]) ||
			!integer(node[4])
		)
			invalid("view");
		const buffer = values[reference(node[2])];
		if (!(buffer instanceof ArrayBuffer)) invalid("view buffer");
		const Type = VIEW_TYPES.get(node[1]);
		const size = Type.BYTES_PER_ELEMENT || 1;
		if (node[3] % size !== 0 || node[3] + node[4] * size > buffer.byteLength)
			invalid("view bounds");
		values[index] = new Type(buffer, node[3], node[4]);
	}
	for (let index = 0; index < nodes.length; index++) {
		const node = nodes[index],
			value = values[index];
		if (node[0] === "o" || node[0] === "a") {
			if (!Array.isArray(node[2])) invalid("properties");
			const keys = new Set();
			for (const entry of node[2]) {
				if (
					!Array.isArray(entry) ||
					entry.length !== 2 ||
					typeof entry[0] !== "string" ||
					keys.has(entry[0])
				)
					invalid("property");
				const [key, item] = entry;
				if (
					node[0] === "a" &&
					(key === "length" ||
						(/^(0|[1-9]\d*)$/.test(key) &&
							Number(key) < 4294967295 &&
							Number(key) >= node[1]))
				)
					invalid("array property");
				keys.add(key);
				Object.defineProperty(value, key, {
					value: token(item),
					enumerable: true,
					writable: true,
					configurable: true,
				});
			}
		} else if (node[0] === "m") {
			if (!Array.isArray(node[1])) invalid("map entries");
			for (const entry of node[1]) {
				if (!Array.isArray(entry) || entry.length !== 2) invalid("map entry");
				value.set(token(entry[0]), token(entry[1]));
			}
		} else if (node[0] === "s") {
			if (!Array.isArray(node[1])) invalid("set entries");
			for (const item of node[1]) value.add(token(item));
		} else if (node[0] === "d") {
			const time = token(node[1]);
			if (typeof time !== "number") invalid("date value");
			value.setTime(time);
		}
	}
	return token(root);
}
