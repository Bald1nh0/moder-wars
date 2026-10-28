import { getSimulationMode } from "./feature-flags.js";
import { gameText } from "./i18n.js";
import {
	decodeSimulationMessage,
	encodeSimulationMessage,
} from "./simulation-wire.js";

const MAX_QUEUED_BYTES = 512 * 1024 * 1024;
const MAX_QUEUED_MESSAGES = 8;

/** Worker-compatible transport; each connection owns a separate server game. */
export class RemoteSimulationWorker {
	constructor(url, { onStatus = () => {}, WebSocketClass = WebSocket } = {}) {
		this.onmessage = null;
		this.onerror = null;
		this.closed = false;
		this.pending = [];
		this.pendingBytes = 0;
		this.closeTimer = null;
		this.termination = new Promise((resolve, reject) => {
			this.resolveClose = resolve;
			this.rejectClose = reject;
		});
		// stop() can initiate closing without awaiting it; the next owner waits.
		this.termination.catch(() => {});
		this.reportStatus = onStatus;
		this.startedAt = performance.now();
		this.stats = {
			state: "connecting",
			bytesSent: 0,
			bytesReceived: 0,
			snapshots: 0,
			encodeMs: 0,
			decodeMs: 0,
			connectedMs: null,
			readyMs: null,
			lastTick: 0,
			extensions: "",
		};
		this.reportStatus({ ...this.stats });
		this.socket = new WebSocketClass(url);
		this.socket.binaryType = "arraybuffer";
		this.socket.onopen = () => {
			if (this.closed) return;
			this.stats.extensions = this.socket.extensions || "";
			this.stats.connectedMs = performance.now() - this.startedAt;
			this.update("initializing");
			const pending = this.pending;
			this.pending = [];
			this.pendingBytes = 0;
			for (const packet of pending) this.sendPacket(packet);
		};
		this.socket.onmessage = ({ data }) => {
			if (this.closed) return;
			try {
				const began = performance.now();
				this.stats.bytesReceived += data.byteLength;
				const message = decodeSimulationMessage(data);
				this.stats.decodeMs += performance.now() - began;
				if (message.type === "READY") {
					this.stats.readyMs = performance.now() - this.startedAt;
					this.update("ready");
				} else if (message.type === "SNAPSHOT") {
					this.stats.snapshots++;
					this.stats.lastTick =
						message.snapshot.values._simTickCount ?? this.stats.lastTick;
				} else if (message.type === "ERROR") {
					this.stats.error = message.message;
					this.update("error");
				}
				this.onmessage?.({ data: message });
			} catch (error) {
				this.fail(error);
			}
		};
		this.socket.onerror = () =>
			this.fail(new Error("Server connection failed"));
		this.socket.onclose = ({ code, reason }) => {
			clearTimeout(this.closeTimer);
			this.resolveClose();
			this.fail(
				new Error(
					`Server connection closed (${code})${reason ? `: ${reason}` : ""}`,
				),
			);
		};
	}

	update(state) {
		this.stats.state = state;
		this.reportStatus({ ...this.stats });
	}

	fail(error) {
		if (this.closed) return;
		this.stats.error = error.message;
		this.update("error");
		this.terminate();
		this.onerror?.(error);
	}

	sendPacket(packet) {
		if (this.closed) return;
		if (this.socket.bufferedAmount + packet.byteLength > MAX_QUEUED_BYTES) {
			this.fail(new Error("Server connection send buffer exceeded its limit"));
			return;
		}
		try {
			this.socket.send(packet);
			this.stats.bytesSent += packet.byteLength;
		} catch (error) {
			this.fail(error);
		}
	}

	postMessage(message, transfer = []) {
		if (this.closed) return;
		if (message.type === "INIT")
			this.stats.initialControl = {
				paused: message.state.isPaused,
				speed: message.state.simSpeed,
				gameState: message.state.gameState,
			};
		if (message.type === "CONTROL")
			this.stats.lastControl = {
				paused: message.paused,
				speed: message.speed,
				perfMode: message.perfMode,
				perfResetGeneration: message.perfResetGeneration,
			};
		try {
			const began = performance.now();
			const packet = encodeSimulationMessage(message);
			// The packet owns its bytes. Match worker transfer semantics so the
			// temporary captured state does not retain another full set of grids.
			if (transfer.length) structuredClone(null, { transfer });
			this.stats.encodeMs += performance.now() - began;
			if (this.socket.readyState === 1) this.sendPacket(packet);
			else if (this.socket.readyState === 0) {
				if (
					this.pending.length >= MAX_QUEUED_MESSAGES ||
					this.pendingBytes + packet.byteLength > MAX_QUEUED_BYTES
				)
					throw new Error("Server connection queue exceeded its limit");
				this.pending.push(packet);
				this.pendingBytes += packet.byteLength;
			} else throw new Error("Server connection is not open");
		} catch (error) {
			this.fail(error);
		}
	}

	terminate() {
		if (this.closed) return this.termination;
		this.closed = true;
		this.pending = [];
		this.pendingBytes = 0;
		this.socket.close();
		if (this.socket.readyState === 3) this.resolveClose();
		else
			this.closeTimer = setTimeout(
				() => this.rejectClose(new Error("Server connection did not close")),
				5000,
			);
		if (this.stats.state !== "error") this.update("idle");
		return this.termination;
	}
}

/** The prototype is opt-in and never silently switches back to local ticks. */
export function createRemoteSimulationOptions(mode = getSimulationMode()) {
	if (mode !== "server") return {};
	let current = null;
	let status = { state: "idle" };
	const badge = document.createElement("div");
	badge.id = "server-simulation-status";
	badge.setAttribute("role", "status");
	badge.style.cssText =
		"position:fixed;bottom:8px;left:8px;z-index:10000;max-width:min(90vw,460px);padding:7px 10px;border:1px solid #6ba6bc;border-radius:6px;background:#101e2bee;color:#e3f3ff;font:13px system-ui;pointer-events:none";
	const render = () => {
		badge.textContent = gameText(`SERVER_SIM_${status.state.toUpperCase()}`);
		badge.style.borderColor = status.state === "error" ? "#ff7777" : "#6ba6bc";
	};
	const update = (next) => {
		status = next;
		render();
	};
	document.body.append(badge);
	document.addEventListener("languagechange", render);
	render();
	Object.defineProperty(window, "serverSimulationStatus", {
		configurable: true,
		get: () => ({ ...(current?.stats || status), mode: "server" }),
	});
	return {
		allowLocalFallback: false,
		startupTimeoutMs: 120000,
		handoffTimeoutMs: 120000,
		onFailure: (error) => {
			if (current) {
				current.stats.error = error.message;
				current.update("error");
			} else update({ state: "error", error: error.message });
		},
		workerFactory: () => {
			const url = new URL("/simulation", location.href);
			url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
			current = new RemoteSimulationWorker(url, { onStatus: update });
			return current;
		},
	};
}
