import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { gameText } from "../src/i18n.js";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const controls = readFileSync(new URL("../src/menu-controls.js", import.meta.url), "utf8");
const setup = readFileSync(new URL("../src/conflict-setup.js", import.meta.url), "utf8");
const audio = readFileSync(new URL("../src/audio.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = main.indexOf("export function checkAutoLaunch()");
const end = main.indexOf("// Settings Tab Logic", start);
const boot = main.slice(start, end).replace("export function", "function");
for (const remember of [false, true]) {
	const elements = new Map();
	const element = (id) => {
		if (!elements.has(id)) elements.set(id, { style: {}, checked: false, value: "" });
		return elements.get(id);
	};
	let initialized = 0;
	let restored = 0;
	const context = vm.createContext({
		gameText,
		settingsController: { restore() { restored++; } },
		getCookie: (key) => key === "mw_skip_settings" ? String(remember) : null,
		document: { getElementById: element, body: { classList: { add() {}, remove() {} } } },
		initializeEngine: () => { initialized++; },
		settingsOverlay: element("settings"), mainMenu: element("menu"), launchBtn: element("launch"),
		mapResSelect: element("map"), gridResSelect: element("grid"), unitLimitSelect: element("units"),
		setupDisableMountainsCheckbox: element("mountains"), disableCountryGradientCheckbox: element("gradient"),
		disableInvisibleBuffsCheckbox: element("buffs"), disableAutoFullscreenCheckbox: null,
		useSystemFontCheckbox: element("font"), saveSkipCheckbox: element("remember"),
	});
	vm.runInContext(boot, context);
	context.checkAutoLaunch();
	assert.equal(initialized, 1);
	assert.equal(restored, remember ? 1 : 0, "remembered launch restores settings once");
	assert.equal(context.settingsOverlay.style.display, "none", "first launch must not require settings");
	assert.equal(context.mainMenu.style.display, "flex");
	assert.equal(context.gameState, "MAIN_MENU");
}
assert.equal((controls.match(/requestFullscreen\(/g) || []).length, 1, "only the explicit fullscreen action requests fullscreen");
const clickHandler = audio.slice(audio.indexOf("// Global click listener"));
assert.doesNotMatch(clickHandler, /requestFullscreen/);
assert.doesNotMatch(main + controls, /addEventListener\("dblclick"/);
assert.ok(!html.includes('id="war-desk-overview-tab"'));
assert.ok(setup.includes('<details class="country-configuration">'));
assert.ok(setup.includes('expandedCountries.has('), "keep Configure expanded while editing country options");
const menuStart = html.indexOf('id="hud-menu"');
const menuEnd = html.indexOf('</details>', menuStart);
for (const id of ['quick-restart-btn', 'restart-scenario-btn', 'god-mode-btn', 'ingame-settings-btn', 'main-menu-btn']) {
	assert.ok(html.slice(menuStart, menuEnd).includes(`id="${id}"`), `${id} belongs in the utility menu`);
}
const versionStart = main.indexOf('const titleScreenVersion =');
const versionEnd = main.indexOf(';', main.indexOf('titleScreenVersion.textContent', versionStart)) + 1;
const versionNode = {};
const versionContext = vm.createContext({ document: {
	title: "MW-V0.27.99", getElementById: () => versionNode,
} });
vm.runInContext(main.slice(versionStart, versionEnd), versionContext);
assert.equal(versionNode.textContent, "v0.27.99", "footer follows the authoritative title version without a third version constant");
const constants = readFileSync(new URL("../src/constants.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("../workers/service-worker.js", import.meta.url), "utf8");
const backdrop = readFileSync(new URL("../assets/images/title-map.svg", import.meta.url), "utf8");
assert.ok(constants.includes('"scroller-choice-modern": "assets/images/title-map.svg"'));
assert.ok(worker.includes('"assets/images/title-map.svg"'), "dedicated background is available in the offline shell");
assert.ok(backdrop.includes('viewBox="0 0 2760 1800"'));
assert.doesNotMatch(backdrop, /NaN|Infinity/);
console.log("UI modernization smoke tests passed");

// Exercise the real exit handler without navigating away from the test process.
for (const [gameState, initiallyPaused, accepted] of [
    ["SIMULATING", false, false], ["SIMULATING", true, false],
    ["SIMULATING", false, true], ["SIMULATING", true, true],
    ["SELECTING", false, false], ["SELECTING", false, true],
]) {
    let handler, answer, prompts = 0, reloads = 0, stops = 0, toggles = 0;
    const runtime = {
        gameState, isPaused: initiallyPaused,
        togglePause() { this.isPaused = !this.isPaused; toggles++; },
        simulationClient: { stop() { stops++; } },
    };
    const context = vm.createContext({
        gameText,
        document: { getElementById: () => ({ addEventListener: (_, fn) => { handler = fn; } }) },
        location: { reload() { reloads++; } },
        showConfirm(message, options) {
            prompts++;
            assert.ok(message.includes("no automatic save"));
            assert.equal(options.okLabel, "Leave without saving");
            assert.equal(options.cancelLabel, "Stay in game");
            return new Promise(resolve => { answer = resolve; });
        },
    });
    vm.runInContext(controls.replace(/^import .*;$/gm, "").replace("export function", "function"), context);
    context.createMenuControls(runtime).bindMainMenuBtnClick();
    const pending = handler();
    if (gameState === "SIMULATING") assert.equal(runtime.isPaused, true);
    await handler();
    assert.equal(prompts, 1, "repeated clicks must not queue exit dialogs");
    answer(accepted);
    await pending;
    assert.equal(reloads, Number(accepted));
    assert.equal(stops, Number(accepted));
    if (!accepted) assert.equal(runtime.isPaused, initiallyPaused, "cancel restores the prior pause state");
    assert.equal(toggles, gameState === "SIMULATING" && !initiallyPaused ? (accepted ? 1 : 2) : 0);
}
assert.ok(main.includes("menu_controls.bindMainMenuBtnClick();"));
console.log("Main menu exit: running/paused/setup, cancel, confirm and duplicate clicks passed");
