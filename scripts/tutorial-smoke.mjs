import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { getTranslation } from "../src/i18n.js";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const controls = readFileSync(
	new URL("../src/menu-controls.js", import.meta.url),
	"utf8",
);
const warStart = readFileSync(
	new URL("../src/war-start.js", import.meta.url),
	"utf8",
);
const start = main.indexOf("export const tutorialOverlay =");
const end = main.indexOf("menu_controls.bindTutorialSkipBtnClick();", start);
assert.ok(start > 0 && end > start);
const source = main.slice(start, end).replaceAll("export ", "");
const elements = new Map();
const element = (id) => {
	if (!elements.has(id))
		elements.set(id, {
			style: {},
			attributes: {},
			disabled: false,
			innerHTML: "",
			innerText: "",
			textContent: "",
			setAttribute(key, value) {
				this.attributes[key] = value;
			},
			addEventListener(type, handler) {
				this[`on${type}`] = handler;
			},
			click() {
				if (!this.disabled) this.onclick?.();
			},
		});
	return elements.get(id);
};
let language = "en",
	mapLoads = 0;
const cookies = new Map();
const tutorialNotifications = [];
const context = vm.createContext({
	document: {
		getElementById: element,
		dispatchEvent: (event) => tutorialNotifications.push(event.type),
	},
	CustomEvent: class {
		constructor(type) {
			this.type = type;
		}
	},
	gameText: (key, parameters) =>
		getTranslation(key, language, null, parameters),
	setCookie: (key, value) => cookies.set(key, value),
	choiceModernDay: {
		click() {
			mapLoads++;
		},
	},
});
vm.runInContext(source, context);
const value = (expression) => vm.runInContext(expression, context);
const conquest = value("conquestTutorialSteps");
const editor = value("editorTutorialSteps");
const next = element("tutorial-next-btn");
const previous = element("tutorial-prev-btn");
const counter = element("tutorial-dots");
const body = element("tutorial-step-container");
assert.equal(conquest.length, 13);
assert.equal(
	editor.length,
	6,
	"The editor guide retains its existing six steps",
);

// Execute the production handlers without booting the map or rendering engine.
const runtime = {
	gameMode: "CONQUEST",
	gameState: "SELECTING_P1",
	campaign: null,
	tutorialPrevBtn: previous,
	conquestTutorialSteps: conquest,
	editorTutorialSteps: editor,
	startTutorial: context.startTutorial,
	updateTutorialUI: context.updateTutorialUI,
	advanceTutorial: context.advanceTutorial,
	endTutorial: context.endTutorial,
	get tutorialActive() {
		return value("tutorialActive");
	},
	get activeTutorialSet() {
		return value("activeTutorialSet");
	},
	get currentTutorialStep() {
		return value("currentTutorialStep");
	},
	set currentTutorialStep(step) {
		context.newStep = step;
		value("currentTutorialStep = newStep");
	},
};
context.runtime = runtime;
vm.runInContext(
	controls.replace(/^import .*;$/gm, "").replace("export function", "function"),
	context,
);
const menu = context.createMenuControls(runtime);
menu.bindHelpBtnClick();
menu.bindTutorialPrevBtnClick();
menu.bindTutorialSkipBtnClick();

// The original guided exercise still waits for its map/country/war actions.
context.startTutorial(conquest, "mw_tutorial_finished");
assert.equal(counter.textContent, "Step 1 of 13");
body.scrollTop = 80;
next.click();
assert.equal(body.scrollTop, 0, "Each page starts at the top after scrolling");
assert.equal(runtime.currentTutorialStep, 1);
next.click();
assert.equal(mapLoads, 1);
assert.equal(runtime.currentTutorialStep, 2);
assert.equal(next.disabled, true);
next.click();
assert.equal(
	runtime.currentTutorialStep,
	2,
	"Next cannot bypass required side selection",
);
const selectionStart = main.indexOf("// Tutorial Progression Logic");
const selectionEnd = main.indexOf(
	"\n}\n\nfunction getCountryLivePersonnel",
	selectionStart,
);
assert.ok(selectionStart > 0 && selectionEnd > selectionStart);
const selection = main.slice(selectionStart, selectionEnd);
context.countryName = "Ukraine";
context.activeSideIndex = 0;
vm.runInContext(selection, context);
assert.equal(runtime.currentTutorialStep, 2);
context.countryName = "Germany";
vm.runInContext(selection, context);
assert.equal(runtime.currentTutorialStep, 3);
context.countryName = "Poland";
vm.runInContext(selection, context);
assert.equal(
	runtime.currentTutorialStep,
	3,
	"The opponent must be added to Side B",
);
context.activeSideIndex = 1;
vm.runInContext(selection, context);
assert.equal(runtime.currentTutorialStep, 4);
assert.equal(next.disabled, true);
const launchStart = warStart.lastIndexOf(
	"\t\tif (",
	warStart.indexOf("runtime.tutorialActive"),
);
const launchEnd = warStart.indexOf(
	"// Initialize displayed manpower",
	launchStart,
);
assert.ok(launchStart > 0 && launchEnd > launchStart);
vm.runInContext(warStart.slice(launchStart, launchEnd), context);
assert.equal(
	runtime.currentTutorialStep,
	5,
	"Starting a war advances to the frontline guide",
);
next.click();
assert.equal(
	runtime.currentTutorialStep,
	6,
	"Campaign guidance follows the existing setup flow",
);
previous.click();
assert.equal(runtime.currentTutorialStep, 5);

// Manual Help is always a reference and must preserve loaded scenarios/selections.
for (const state of [
	"SELECTING_P1",
	"SELECTING_P2",
	"SIMULATING",
	"WAR_OVER",
]) {
	runtime.gameState = state;
	runtime.campaign = null;
	element("help-btn").click();
	assert.equal(
		runtime.currentTutorialStep,
		["SIMULATING", "WAR_OVER"].includes(state) ? 5 : 0,
	);
	while (runtime.currentTutorialStep > 0) previous.click();
	for (let page = 0; page < conquest.length; page++) {
		assert.equal(
			next.disabled,
			false,
			`Reference page ${page} must not wait for a game action`,
		);
		next.click();
	}
	assert.equal(runtime.tutorialActive, false);
	assert.equal(
		mapLoads,
		1,
		`${state}: reading Help must not load or replace any map`,
	);
}
assert.equal(
	conquest[1].actionRequired,
	"LOAD_MAP",
	"Reference mode must not mutate the reusable guided steps",
);
assert.equal(conquest[2].actionRequired, "SELECT_GERMANY");
assert.equal(cookies.get("mw_tutorial_finished"), "true");

for (const lang of ["en", "uk", "ru"]) {
	language = lang;
	context.startTutorial(conquest, "mw_tutorial_finished", { reference: true });
	for (const [index, step] of conquest.entries()) {
		assert.ok(body.innerHTML.includes(getTranslation(step.title, lang)));
		assert.ok(body.innerHTML.includes(getTranslation(step.content, lang)));
		assert.doesNotMatch(body.innerHTML, /GAME_TUTORIAL_/);
		assert.equal(
			counter.textContent,
			getTranslation("GAME_TUTORIAL_PROGRESS", lang, null, {
				current: index + 1,
				total: conquest.length,
			}),
		);
		assert.equal(
			next.innerText,
			getTranslation(
				index === conquest.length - 1 ? "GAME_FINISH" : "GAME_NEXT",
				lang,
			),
		);
		next.click();
	}
}

runtime.gameMode = "EDITOR";
runtime.gameState = "EDITOR_ACTIVE";
element("help-btn").click();
assert.equal(value("activeTutorialKey"), "mw_editor_tutorial_finished");
assert.equal(runtime.activeTutorialSet, editor);
for (let index = 0; index < editor.length; index++) next.click();
assert.equal(cookies.get("mw_editor_tutorial_finished"), "true");
assert.equal(runtime.tutorialActive, false);
element("help-btn").click();
element("tutorial-skip-btn").click();
assert.equal(element("tutorial-overlay").style.display, "none");
assert.equal(runtime.tutorialActive, false);
assert.equal(mapLoads, 1);
assert.ok(
	tutorialNotifications.length >= conquest.length,
	"Page navigation notifies dialog hosts to keep the guide in the visible layer",
);
assert.equal(
	tutorialNotifications.at(-1),
	"tutorialchange",
	"Finishing or skipping notifies the dialog host to remove its empty guide area",
);

for (const lang of ["en", "uk", "ru"]) {
	const instructions = getTranslation("GAME_TUTORIAL_ECONOMY_CONTENT", lang);
	for (const key of [
		"CAMPAIGN_TITLE",
		"CAMPAIGN_COUNTRY",
		"CAMPAIGN_MANAGEMENT",
		"CAMPAIGN_ROLE",
		"CAMPAIGN_QUANTITY",
		"CAMPAIGN_TRAIN",
		"CAMPAIGN_EQUIPMENT",
		"CAMPAIGN_PRODUCE",
	]) {
		assert.ok(
			instructions.includes(getTranslation(key, lang)),
			`${lang}: economy instructions must name the actual ${key} control`,
		);
	}
}

console.log(
	"Tutorial: guided setup auto-advance, 13 localized campaign steps, safe reference navigation, progress, skip and editor preservation passed.",
);
