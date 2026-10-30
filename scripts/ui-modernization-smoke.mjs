import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { getAppBuildLabel, getAppVersion, getAppVersionLabel } from "../src/app-version.js";
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
const versionDocument = {
	title: "Modern Wars", getElementById: () => versionNode,
	querySelector: (selector) => selector === 'meta[name="application-version"]' ? { content: "0.30.0" } : null,
};
const versionContext = vm.createContext({ document: versionDocument, getAppVersionLabel: () => getAppVersionLabel(versionDocument) });
vm.runInContext(main.slice(versionStart, versionEnd), versionContext);
assert.equal(versionNode.textContent, "v0.30.0", "footer follows build metadata while the browser title stays constant");
assert.equal(getAppBuildLabel(versionDocument), "Modern Wars v0.30.0", "performance reports retain versioned build identity");
assert.equal(getAppVersion(), "development", "Node imports need no document");
for (const content of ["__MW_APP_VERSION__", "", undefined, "Modern Wars"]) {
	const documentLike = { querySelector: () => ({ content }) };
	assert.equal(getAppVersionLabel(documentLike), "development");
	assert.equal(getAppBuildLabel(documentLike), "Modern Wars development");
}
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

// Exercise HUD placement with wrapped controls and the editor above the status bar.
{
    const handlers = {};
    const panel = { style: {} };
    const menu = {
        open: true,
        querySelector: () => panel,
        addEventListener: (type, handler) => { handlers[type] = handler; },
    };
    let bounds = { top: 16, bottom: 168 };
    const header = { clientTop: 1, getBoundingClientRect: () => bounds };
    const root = { clientHeight: 568 };
    const context = vm.createContext({
        document: {
            documentElement: root,
            getElementById: id => id === "hud-menu" ? menu : header,
        },
        window: { addEventListener: (type, handler) => { handlers[type] = handler; } },
    });
    vm.runInContext(controls.replace(/^import .*;$/gm, "").replace("export function", "function"), context);
    context.createMenuControls({}).bindHudMenuClick();
    for (const [height, top, barHeight] of [[568, 16, 152], [720, 141, 66], [320, 120, 190]]) {
        root.clientHeight = height;
        bounds = { top, bottom: top + barHeight };
        handlers.resize();
        const menuTop = top + header.clientTop + Number.parseFloat(panel.style.top);
        const menuHeight = Number.parseFloat(panel.style.maxHeight);
        assert.ok(menuTop >= 8 && menuHeight >= 100, "menu keeps a usable scroll area");
        assert.ok(menuTop + menuHeight <= height - 16, "menu stays inside the viewport");
    }
    handlers.click({ target: { closest: () => ({}) } });
    assert.equal(menu.open, false, "choosing a menu action closes the menu");
    const previousTop = panel.style.top;
    handlers.resize();
    assert.equal(panel.style.top, previousTop, "closed menus do not perform layout work");
}
console.log("HUD menu: wrapped controls, editor offset, short viewports and action dismissal passed");
