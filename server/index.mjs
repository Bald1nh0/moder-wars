import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { WebSocket, WebSocketServer } from "ws";

const MiB = 1024 * 1024;
const contentTypes = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".wav": "audio/wav",
	".wasm": "application/wasm",
};

/** A LAN-only experiment: each connection owns a disposable simulation. */
export async function createSimulationServer({
	staticDir,
	maxSessions = 2,
	maxPayload = 512 * MiB,
	initTimeoutMs = 120_000,
	heartbeatMs = 30_000,
	logger = console,
} = {}) {
	if (!staticDir)
		throw new Error("MW_STATIC_DIR must point to an isolated Vite build");
	if (!Number.isSafeInteger(maxSessions) || maxSessions < 1 || maxSessions > 8)
		throw new Error("maxSessions must be between 1 and 8");
	const root = await realpath(staticDir);
	if (!(await stat(resolve(root, "index.html"))).isFile())
		throw new Error("Static build has no index.html");
	const sessions = new Set();
	const metrics = {
		accepted: 0,
		ready: 0,
		snapshots: 0,
		receivedBytes: 0,
		sentBytes: 0,
		failures: 0,
	};
	const server = createServer(async (req, res) => {
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader("Cache-Control", "no-store");
		try {
			if (req.method !== "GET" && req.method !== "HEAD") {
				res.writeHead(405, { Allow: "GET, HEAD" }).end();
				return;
			}
			const pathname = decodeURIComponent(
				new URL(req.url, "http://localhost").pathname,
			);
			if (pathname === "/health") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(
					req.method === "HEAD"
						? undefined
						: JSON.stringify({
								status: "ok",
								mode: "experimental-server-simulation",
								sessions: sessions.size,
								maxSessions,
								byteCounters: "uncompressed-wire-payload",
								...metrics,
							}),
				);
				return;
			}
			if (
				pathname.includes("\0") ||
				pathname.split("/").some((part) => part.startsWith("."))
			) {
				res.writeHead(403).end();
				return;
			}
			const filename = await realpath(
				resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`),
			);
			const fromRoot = relative(root, filename);
			if (
				fromRoot === ".." ||
				fromRoot.startsWith(`..${sep}`) ||
				isAbsolute(fromRoot)
			) {
				res.writeHead(403).end();
				return;
			}
			const info = await stat(filename);
			if (!info.isFile()) {
				res.writeHead(404).end();
				return;
			}
			res.writeHead(200, {
				"Content-Type":
					contentTypes[extname(filename)] || "application/octet-stream",
				"Content-Length": info.size,
			});
			if (req.method === "HEAD") res.end();
			else
				createReadStream(filename)
					.on("error", () => res.destroy())
					.pipe(res);
		} catch {
			if (!res.headersSent) res.writeHead(404);
			res.end();
		}
	});
	const wss = new WebSocketServer({
		noServer: true,
		maxPayload,
		perMessageDeflate: {
			serverNoContextTakeover: true,
			clientNoContextTakeover: true,
			concurrencyLimit: 2,
			threshold: 1024,
			zlibDeflateOptions: { level: 1 },
		},
	});
	server.on("upgrade", (req, socket, head) => {
		socket.on("error", () => socket.destroy());
		const reject = (status) => {
			socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
		};
		if (req.url !== "/simulation") return reject("404 Not Found");
		const expectedOrigin = `${req.socket.encrypted ? "https" : "http"}://${req.headers.host}`;
		if (req.headers.origin !== expectedOrigin) return reject("403 Forbidden");
		if (sessions.size >= maxSessions) return reject("503 Service Unavailable");
		wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
	});
	wss.on("connection", (socket) => {
		const worker = new Worker(
			new URL("./simulation-worker.mjs", import.meta.url),
			{
				resourceLimits: { maxOldGenerationSizeMb: 2048 },
			},
		);
		const session = {
			socket,
			worker,
			alive: true,
			pendingBytes: 0,
			pendingMessages: 0,
			closed: false,
			receivedInitial: false,
		};
		sessions.add(session);
		metrics.accepted++;
		const timeout = setTimeout(
			() => fail("Simulation initialization timed out"),
			initTimeoutMs,
		);
		function cleanup() {
			if (session.closed) return;
			session.closed = true;
			clearTimeout(timeout);
			sessions.delete(session);
			void worker.terminate();
		}
		session.cleanup = cleanup;
		function fail(reason) {
			if (session.closed) return;
			metrics.failures++;
			logger.warn(`[simulation] ${reason}`);
			socket.close(1011, "Simulation session failed");
			cleanup();
			const closeTimeout = setTimeout(() => socket.terminate(), 1000);
			closeTimeout.unref();
		}
		socket.on("pong", () => {
			session.alive = true;
		});
		socket.on("close", cleanup);
		socket.on("error", (error) => fail(error.message));
		worker.on("error", (error) => fail(error.message));
		worker.on("exit", (code) => {
			if (!session.closed) fail(`Worker exited (${code})`);
		});
		socket.on("message", (buffer, binary) => {
			if (session.closed) return;
			if (!binary) return fail("Only binary simulation messages are supported");
			if (session.receivedInitial && buffer.byteLength > MiB)
				return fail("Simulation command exceeded its limit");
			session.receivedInitial = true;
			if (
				session.pendingMessages >= 128 ||
				session.pendingBytes + buffer.byteLength > maxPayload
			)
				return fail("Simulation input queue exceeded its limit");
			metrics.receivedBytes += buffer.byteLength;
			session.pendingBytes += buffer.byteLength;
			session.pendingMessages++;
			// Transfer an owned packet so pooled Node buffers cannot detach unrelated data.
			const packet = Uint8Array.from(buffer);
			worker.postMessage(packet, [packet.buffer]);
		});
		worker.on("message", ({ packet, type, consumed, failure }) => {
			if (session.closed) return;
			if (failure) return fail(failure);
			if (consumed != null) {
				session.pendingBytes -= consumed;
				session.pendingMessages--;
				return;
			}
			if (!packet || socket.readyState !== WebSocket.OPEN) return;
			if (socket.bufferedAmount + packet.byteLength > maxPayload)
				return fail("Simulation output queue exceeded its limit");
			if (type === "READY") {
				clearTimeout(timeout);
				metrics.ready++;
			}
			if (type === "SNAPSHOT") metrics.snapshots++;
			metrics.sentBytes += packet.byteLength;
			socket.send(packet, { binary: true }, (error) => {
				if (error) fail(error.message);
				else if (type === "ERROR") fail("Simulation owner reported an error");
			});
		});
	});
	const heartbeat = setInterval(() => {
		for (const session of sessions) {
			if (!session.alive) {
				session.socket.terminate();
				continue;
			}
			session.alive = false;
			session.socket.ping();
		}
	}, heartbeatMs);
	heartbeat.unref();
	return {
		server,
		metrics,
		get sessionCount() {
			return sessions.size;
		},
		async listen(port = 4180, host = "127.0.0.1") {
			await new Promise((resolveListen, reject) => {
				server.once("error", reject);
				server.listen(port, host, () => {
					server.off("error", reject);
					resolveListen();
				});
			});
			return server.address();
		},
		async close() {
			clearInterval(heartbeat);
			const workers = [...sessions].map((session) => {
				session.cleanup();
				session.socket.terminate();
				return session.worker.terminate();
			});
			sessions.clear();
			await Promise.all(workers);
			await new Promise((resolveClose) => wss.close(resolveClose));
			if (server.listening)
				await new Promise((resolveClose) => server.close(resolveClose));
		},
	};
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const app = await createSimulationServer({
		staticDir: process.env.MW_STATIC_DIR,
		maxSessions: Number(process.env.MW_MAX_SESSIONS || 2),
	});
	const host = process.env.MW_HOST || "127.0.0.1";
	const address = await app.listen(Number(process.env.MW_PORT || 4180), host);
	console.log(
		`Server simulation prototype: http://${host}:${address.port}/?simulation=server`,
	);
	console.log(
		"Sessions are isolated and disappear on disconnect. Do not expose this prototype publicly.",
	);
	for (const signal of ["SIGINT", "SIGTERM"])
		process.once(signal, async () => {
			await app.close();
			process.exit(0);
		});
}
