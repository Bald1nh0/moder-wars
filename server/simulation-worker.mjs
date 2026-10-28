import { parentPort } from "node:worker_threads";
import {
	decodeSimulationMessage,
	encodeSimulationMessage,
} from "../src/simulation-wire.js";
import { installWorkerScheduler } from "./worker-scheduler.mjs";

installWorkerScheduler();

let initialized = false;
const messageTypes = new Set(["INIT", "ACK", "CONTROL", "COMMAND", "HANDOFF"]);
globalThis.self = {
	postMessage(message) {
		// A failed owner cannot safely resume remotely; avoid sending a huge state
		// dump or internal stack trace over the connection just to report failure.
		if (message.type === "ERROR")
			message = {
				type: "ERROR",
				epoch: message.epoch,
				message: "Server simulation failed",
			};
		const packet = encodeSimulationMessage(message);
		parentPort.postMessage({ packet, type: message.type }, [packet.buffer]);
	},
};
await import("../workers/war-simulation-worker.js");

parentPort.on("message", (packet) => {
	try {
		const message = decodeSimulationMessage(packet);
		if (
			!message ||
			!messageTypes.has(message.type) ||
			!Number.isSafeInteger(message.epoch)
		)
			throw new Error("Invalid simulation message");
		if (message.type === "INIT") {
			if (initialized)
				throw new Error("A connection can initialize only one simulation");
			const state = message.state;
			const cells = state?.gridWidth * state?.gridHeight;
			if (
				!Number.isSafeInteger(state?.gridWidth) ||
				!Number.isSafeInteger(state?.gridHeight) ||
				state.gridWidth < 1 ||
				state.gridHeight < 1 ||
				!Number.isSafeInteger(cells) ||
				cells > 10_000_000 ||
				!(state.landMask instanceof Uint8Array) ||
				state.landMask.length !== cells ||
				!Array.isArray(state.units) ||
				state.units.length > 100_000
			)
				throw new Error("Invalid or oversized simulation state");
			initialized = true;
		} else if (!initialized)
			throw new Error("INIT is required before simulation commands");
		self.onmessage({ data: message });
		parentPort.postMessage({ consumed: packet.byteLength });
	} catch (error) {
		parentPort.postMessage({ failure: error.message });
	}
});
