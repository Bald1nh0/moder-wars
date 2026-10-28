import { createFeatureFlags, getSimulationMode } from "./feature-flags.js";
import { gameText } from "./i18n.js";
import { COMPILED_SCENARIO_URLS } from "./scenario-codec.js";

export const DEVICE_TEST_OPTIONS = Object.freeze({
	maxUnitsPerSide: 120,
	durationMs: 20000,
	warmupMs: 3000,
	speedIndex: 0,
	viewMode: "POLITICAL",
	perfMode: "basic",
	caseId: "device-world-2026-v1",
});
const REPORTS_KEY = "mw.devicePerformance.v1";
const clone = (value) => JSON.parse(JSON.stringify(value ?? null));

export function deviceTestUrl(href, mode) {
	const url = new URL(href);
	url.search = "";
	url.hash = "";
	url.searchParams.set("performanceTest", "1");
	url.searchParams.set("deviceTest", "1");
	url.searchParams.set("simulation", mode === "server" ? "server" : "browser");
	return url.href;
}

function actualWorkload(report) {
	const { unitCount: _liveUnits, ...config } = report?.config || {};
	return {
		config,
		initialFormationCountBySide: report?.benchmark?.initialFormationCountBySide,
		initialPersonnelBySide: report?.benchmark?.initialPersonnelBySide,
	};
}

export function comparableDeviceReports(browser, server) {
	if (!browser?.valid || !server?.valid) return false;
	if (
		browser.requestedOwner !== "browser" ||
		server.requestedOwner !== "server" ||
		!["worker", "main-thread"].includes(browser.execution?.owner) ||
		server.execution?.owner !== "server"
	)
		return false;
	const signature = (report) =>
		JSON.stringify({
			build: report.build,
			scenario: report.scenario,
			options: report.options,
			settings: report.settings,
			environment: report.environment,
			actualWorkload: actualWorkload(report.report),
		});
	return signature(browser) === signature(server);
}

/** Test orchestration is separate from DOM rendering so invalid runs are testable. */
export function createDeviceTestRunner({
	prepare,
	benchmark,
	stop,
	readOwner,
	readRemote = () => null,
	readEnvironment,
	readSettings,
	watch,
	onUpdate = () => {},
	now = () => performance.now(),
	timeoutMs = 180000,
	mode = "browser",
	build = "unknown",
}) {
	let active = null;
	let generation = 0;
	return {
		get running() {
			return active !== null;
		},
		cancel(reason = "cancelled") {
			active?.abort(reason);
		},
		async run() {
			if (active) throw new Error("A device test is already running");
			const runGeneration = ++generation;
			const controller = new AbortController();
			active = controller;
			const began = now();
			const environment = clone(readEnvironment());
			let settings = null;
			let phase = "loading";
			const abort = new Promise((_, reject) => {
				controller.signal.addEventListener(
					"abort",
					() => {
						stop();
						reject(new Error(String(controller.signal.reason)));
					},
					{ once: true },
				);
			});
			const unsubscribe =
				watch?.((reason) => controller.abort(reason)) || (() => {});
			const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
			const progress = setInterval(() => {
				if (readOwner()?.status === "error") controller.abort("disconnected");
				onUpdate({ phase, seconds: Math.floor((now() - began) / 1000) });
			}, 500);
			onUpdate({ phase, seconds: 0 });
			const operation = (async () => {
				controller.signal.throwIfAborted();
				await prepare(controller.signal);
				controller.signal.throwIfAborted();
				settings = clone(readSettings());
				phase = "running";
				return benchmark({ ...DEVICE_TEST_OPTIONS, signal: controller.signal });
			})();
			// A cancelled loader may finish later; it must never leave an owner running.
			operation
				.finally(() => {
					if (controller.signal.aborted && generation === runGeneration) stop();
				})
				.catch(() => {});
			let report = null;
			let reason = null;
			let error = null;
			try {
				report = await Promise.race([operation, abort]);
				if (!(report?.ticks?.count > 0) || !(report?.frames?.count > 0))
					reason = "no_ticks";
				else if (
					readOwner()?.status !== "ready" ||
					(mode === "server"
						? readOwner()?.owner !== "server"
						: !["worker", "main-thread"].includes(readOwner()?.owner))
				)
					reason = "disconnected";
				else if (
					report.config?.gridRes !== 0.1 ||
					report.config?.mapResolution !== "50m" ||
					report.config?.simSpeed !== 1 ||
					report.config?.viewMode !== "POLITICAL" ||
					JSON.stringify(report.benchmark?.initialFormationCountBySide) !==
						"[120,120]"
				)
					reason = "settings";
				else if (JSON.stringify(settings) !== JSON.stringify(readSettings()))
					reason = "settings";
			} catch (failure) {
				reason = controller.signal.aborted
					? String(controller.signal.reason)
					: failure.code || "failed";
				error = failure.message || String(failure);
			} finally {
				clearTimeout(timeout);
				clearInterval(progress);
				unsubscribe();
			}
			const result = {
				schemaVersion: 1,
				build,
				valid: reason === null,
				reason,
				error,
				requestedOwner: mode,
				execution: clone(readOwner()),
				transport: clone(readRemote()),
				scenario: COMPILED_SCENARIO_URLS.modern,
				options: DEVICE_TEST_OPTIONS,
				environment,
				settings,
				elapsedMs: now() - began,
				finishedAt: new Date().toISOString(),
				report,
				limitations: [
					"independent-random-gameplay",
					"shared-device-load",
					"raw-transport-bytes-before-compression",
					"memory-is-not-total-process-memory",
				],
			};
			stop();
			active = null;
			onUpdate({ phase: reason ? "invalid" : "complete", result });
			return result;
		},
	};
}

function storedReports() {
	try {
		const reports = JSON.parse(localStorage.getItem(REPORTS_KEY) || "{}");
		return reports && typeof reports === "object" ? reports : {};
	} catch {
		return {};
	}
}
function snapshotSettings(runtime) {
	const controls = {};
	for (const element of document.querySelectorAll(
		"#settings-overlay input[id], #settings-overlay select[id]",
	)) {
		if (
			element.type === "file" ||
			element.id === "performance-test-enabled" ||
			element.id === "server-simulation-enabled"
		)
			continue;
		controls[element.id] =
			element.type === "checkbox" ? element.checked : element.value;
	}
	return { config: { ...runtime.CONFIG }, controls };
}
function geometry() {
	return { width: innerWidth, height: innerHeight, devicePixelRatio };
}
function environment() {
	const canvas = document.createElement("canvas");
	const gl = canvas.getContext("webgl");
	const extension = gl?.getExtension("WEBGL_debug_renderer_info");
	const renderer = extension
		? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
		: null;
	gl?.getExtension("WEBGL_lose_context")?.loseContext();
	return {
		userAgent: navigator.userAgent,
		hardwareConcurrency: navigator.hardwareConcurrency,
		deviceMemoryGiB: navigator.deviceMemory ?? null,
		viewport: geometry(),
		renderer,
	};
}
function failure(code) {
	return Object.assign(new Error(code), { code });
}

export function installDevicePerformanceTest(runtime) {
	const dedicated =
		new URLSearchParams(location.search).get("deviceTest") === "1";
	const mode = getSimulationMode();
	const toggle = document.getElementById("performance-test-enabled");
	const entries = [
		document.getElementById("device-test-menu-btn"),
		document.getElementById("benchmark-btn"),
	];
	const panel = document.createElement("section");
	panel.id = "device-test-panel";
	panel.hidden = true;
	panel.setAttribute("role", "dialog");
	panel.setAttribute("aria-labelledby", "device-test-title");
	panel.innerHTML = `
		<div class="device-test-card">
			<h2 id="device-test-title" data-i18n="DEVICE_TEST_TITLE"></h2>
			<div class="device-test-intro">
				<p data-i18n="DEVICE_TEST_INTRO"></p>
				<p data-i18n="DEVICE_TEST_WORKLOAD"></p>
				<p data-i18n="DEVICE_TEST_HELP"></p>
			</div>
			<p id="device-test-status" role="status" aria-live="polite"></p>
			<div class="device-test-actions">
				<a id="device-test-browser" class="mini-btn" target="_blank" rel="noopener" data-i18n="DEVICE_TEST_OPEN_BROWSER"></a>
				<a id="device-test-server" class="mini-btn" target="_blank" rel="noopener" data-i18n="DEVICE_TEST_OPEN_SERVER"></a>
				<button id="device-test-start" class="start-btn" type="button" data-i18n="DEVICE_TEST_START"></button>
				<button id="device-test-cancel" class="mini-btn" type="button" hidden data-i18n="DEVICE_TEST_CANCEL"></button>
				<button id="device-test-download" class="mini-btn" type="button" hidden data-i18n="DEVICE_TEST_DOWNLOAD"></button>
				<button id="device-test-close" class="mini-btn" type="button" data-i18n="DEVICE_TEST_CLOSE"></button>
			</div>
			<div id="device-test-comparison"></div>
		</div>`;
	document.body.append(panel);
	const get = (id) => document.getElementById(`device-test-${id}`);
	get("browser").href = deviceTestUrl(location.href, "browser");
	get("server").href = deviceTestUrl(location.href, "server");
	let latest = null;
	let ran = false;
	let phase = "ready";
	let seconds = 0;
	let runner;
	const renderComparison = () => {
		const area = get("comparison");
		area.replaceChildren();
		const heading = document.createElement("h3");
		heading.textContent = gameText("DEVICE_TEST_COMPARE");
		area.append(heading);
		const reports = storedReports();
		const browser = reports.browser;
		const server = reports.server;
		const notice = document.createElement("p");
		notice.textContent = gameText(
			!browser || !server
				? "DEVICE_TEST_NO_RESULTS"
				: comparableDeviceReports(browser, server)
					? "DEVICE_TEST_VARIANCE"
					: "DEVICE_TEST_MISMATCH",
		);
		area.append(notice);
		if (!browser && !server) return;
		const table = document.createElement("table");
		const row = (cells, header = false) => {
			const tr = document.createElement("tr");
			for (const text of cells) {
				const cell = document.createElement(header ? "th" : "td");
				cell.textContent = text;
				tr.append(cell);
			}
			return tr;
		};
		const head = document.createElement("thead");
		head.append(
			row(
				[
					gameText("DEVICE_TEST_METRIC"),
					gameText("DEVICE_TEST_BROWSER"),
					gameText("DEVICE_TEST_SERVER"),
				],
				true,
			),
		);
		const body = document.createElement("tbody");
		const owner = (value) =>
			gameText(
				`DEVICE_TEST_OWNER_${(value?.execution?.owner || "unknown").replaceAll("-", "_")}`,
			);
		body.append(
			row([gameText("DEVICE_TEST_OWNER"), owner(browser), owner(server)]),
		);
		for (const [key, read] of [
			["DEVICE_TEST_TICK", (value) => value?.report?.ticks?.avgMs],
			["DEVICE_TEST_P95", (value) => value?.report?.ticks?.p95Ms],
			["DEVICE_TEST_FRAME", (value) => value?.report?.frames?.avg],
			["DEVICE_TEST_STARTUP", (value) => value?.execution?.startupMs],
		]) {
			const format = (value) =>
				value?.valid && Number.isFinite(read(value))
					? read(value).toFixed(2)
					: "—";
			body.append(row([gameText(key), format(browser), format(server)]));
		}
		table.append(head, body);
		area.append(table);
		const note = document.createElement("p");
		note.textContent = gameText("DEVICE_TEST_RESULTS_NOTE");
		area.append(note);
	};
	const render = () => {
		for (const element of panel.querySelectorAll("[data-i18n]"))
			element.textContent = gameText(element.dataset.i18n);
		if (!flags.performanceTest)
			get("status").textContent = gameText("DEVICE_TEST_DISABLED");
		else if (phase === "invalid")
			get("status").textContent = gameText("DEVICE_TEST_INVALID", {
				reason: gameText(`DEVICE_TEST_REASON_${latest?.reason || "failed"}`),
			});
		else if (phase === "loading")
			get("status").textContent = gameText("DEVICE_TEST_LOADING");
		else if (phase === "running")
			get("status").textContent = gameText("DEVICE_TEST_RUNNING", { seconds });
		else if (phase === "complete")
			get("status").textContent = gameText("DEVICE_TEST_COMPLETE");
		else
			get("status").textContent = dedicated
				? gameText("DEVICE_TEST_READY", {
						mode: gameText(`DEVICE_TEST_${mode.toUpperCase()}`),
					})
				: "";
		const busy = Boolean(runner?.running);
		panel.classList.toggle("device-test-running", busy);
		get("start").hidden = !dedicated || ran || !flags.performanceTest;
		get("start").disabled = busy;
		get("cancel").hidden = !busy;
		get("close").hidden = busy;
		if (dedicated) get("close").textContent = gameText("MAIN_MENU");
		get("browser").hidden = busy || !flags.performanceTest;
		get("server").hidden = busy || !flags.performanceTest;
		get("download").hidden = busy || !latest;
		get("comparison").hidden = busy;
		if (!busy) renderComparison();
	};
	const flags = createFeatureFlags({
		onChange(enabled) {
			if (toggle) toggle.checked = enabled;
			for (const entry of entries) if (entry) entry.hidden = !enabled;
			if (!enabled) runner?.cancel("disabled");
			render();
		},
	});
	if (toggle) {
		toggle.checked = flags.performanceTest;
		toggle.addEventListener("change", () =>
			flags.setPerformanceTest(toggle.checked),
		);
	}
	const stop = () => {
		runtime.isPaused = true;
		runtime.simulationClient?.stop();
		runtime.gameState = "MAIN_MENU";
		if (runtime.animationFrameId != null)
			cancelAnimationFrame(runtime.animationFrameId);
		if (runtime._benchmarkTimeoutId != null)
			clearTimeout(runtime._benchmarkTimeoutId);
		if (runtime.benchmarkResults)
			runtime.benchmarkResults.style.display = "none";
	};
	runner = createDeviceTestRunner({
		mode,
		build: document.title,
		stop,
		readOwner: () => runtime.simulationClient.diagnostics,
		readRemote: () =>
			mode === "server" ? window.serverSimulationStatus : null,
		readEnvironment: environment,
		readSettings: () => snapshotSettings(runtime),
		watch(invalidate) {
			const initial = JSON.stringify(geometry());
			const check = () => {
				if (document.hidden) invalidate("hidden");
				else if (JSON.stringify(geometry()) !== initial) invalidate("resized");
			};
			document.addEventListener("visibilitychange", check);
			window.addEventListener("resize", check);
			const timer = setInterval(check, 500);
			check();
			return () => {
				document.removeEventListener("visibilitychange", check);
				window.removeEventListener("resize", check);
				clearInterval(timer);
			};
		},
		async prepare(signal) {
			signal.throwIfAborted();
			if (!flags.performanceTest) throw failure("disabled");
			if (!dedicated || runtime.countryMetadata?.length)
				throw failure("not_fresh");
			if (mode === "server") {
				try {
					const response = await fetch(new URL("/health", location.href), {
						cache: "no-store",
						signal,
					});
					const health = await response.json();
					if (health.mode !== "experimental-server-simulation")
						throw failure("unavailable");
				} catch {
					signal.throwIfAborted();
					throw failure("unavailable");
				}
			}
			signal.throwIfAborted();
			// These changes are local to this disposable tab, not saved preferences.
			runtime.settingsController.apply({
				"grid-res-select": "0.1",
				"map-res-select": "50m",
				"disable-auto-fullscreen-checkbox": true,
			});
			runtime.mainMenu.style.display = "none";
			runtime.settingsOverlay.style.display = "none";
			await runtime.performPresetLoad(
				COMPILED_SCENARIO_URLS.modern,
				"CONQUEST",
				{ prederivedEarth: true },
			);
			signal.throwIfAborted();
		},
		benchmark: (options) => runtime.startBenchmark(options),
		onUpdate(update) {
			phase = update.phase;
			seconds = update.seconds || 0;
			if (update.result) {
				latest = update.result;
				const reports = storedReports();
				reports[mode] = latest;
				try {
					localStorage.setItem(
						REPORTS_KEY,
						JSON.stringify({
							browser: reports.browser,
							server: reports.server,
						}),
					);
				} catch {}
			}
			render();
		},
	});
	for (const entry of entries) {
		if (!entry) continue;
		entry.hidden = !flags.performanceTest;
		entry.addEventListener("click", () => {
			if (!flags.performanceTest) return;
			panel.hidden = false;
			render();
			get("browser").focus();
		});
	}
	get("start").addEventListener("click", () => {
		if (!flags.performanceTest || runner.running || ran) return;
		ran = true;
		void runner.run();
	});
	get("cancel").addEventListener("click", () => runner.cancel());
	get("close").addEventListener("click", () => {
		if (dedicated) {
			const url = new URL(location.href);
			url.searchParams.delete("deviceTest");
			location.assign(url.href);
		} else panel.hidden = true;
	});
	get("download").addEventListener("click", () => {
		if (!latest) return;
		const payload = {
			schemaVersion: 1,
			current: latest,
			comparison: storedReports(),
		};
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(payload, null, 2)], {
				type: "application/json",
			}),
		);
		const link = document.createElement("a");
		link.href = url;
		link.download = `modern-wars-${mode}-performance-${Date.now()}.json`;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	});
	const blockGameKeys = (event) => {
		if (!runner.running || event.ctrlKey || event.metaKey) return;
		if (event.key === "Escape" && event.type === "keydown") runner.cancel();
		event.preventDefault();
		event.stopImmediatePropagation();
	};
	document.addEventListener("keydown", blockGameKeys, true);
	document.addEventListener("keyup", blockGameKeys, true);
	document.addEventListener("languagechange", render);
	window.addEventListener("storage", (event) => {
		if (event.key === REPORTS_KEY && !runner.running) renderComparison();
	});
	if (dedicated) panel.hidden = false;
	render();
	return { flags, runner };
}
