import assert from "node:assert/strict";
import {
	campaignDisplayedForces,
	campaignEventCategory,
	campaignForceTotals,
	campaignOrderError,
	campaignOrdersReady,
	campaignPanelState,
	campaignTutorialAction,
	createCampaignDecisionSummary,
	createCampaignTutorialGuide,
	formatCampaignEvent,
	selectCampaignEvents,
} from "../src/campaign-ui.js";
import { CAMPAIGN_TRANSLATIONS } from "../src/translations-campaign.js";

// Exercise real node ownership and focus decisions without claiming browser layout coverage.
class GuideNode extends EventTarget {
	constructor(documentRef) {
		super();
		this.documentRef = documentRef;
		this.children = [];
		this.parentNode = null;
		this.open = false;
		this.hidden = false;
	}
	get nextSibling() {
		return (
			this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] ||
			null
		);
	}
	append(node) {
		node.remove();
		this.children.push(node);
		node.parentNode = this;
	}
	insertBefore(node, before) {
		node.remove();
		const index = before ? this.children.indexOf(before) : this.children.length;
		assert.ok(index >= 0);
		this.children.splice(index, 0, node);
		node.parentNode = this;
	}
	remove() {
		if (this.parentNode)
			this.parentNode.children.splice(
				this.parentNode.children.indexOf(this),
				1,
			);
		this.parentNode = null;
	}
	contains(node) {
		return node === this || this.children.some((child) => child.contains(node));
	}
	querySelector(selector) {
		for (const child of this.children) {
			if (
				selector.startsWith("#")
					? child.id === selector.slice(1)
					: child.className === selector.slice(1)
			)
				return child;
			const nested = child.querySelector(selector);
			if (nested) return nested;
		}
		return null;
	}
	focus() {
		this.documentRef.activeElement = this;
	}
}
const guideDocument = new EventTarget();
guideDocument.createElement = () => new GuideNode(guideDocument);
guideDocument.body = guideDocument.createElement("body");
guideDocument.getElementById = (id) =>
	guideDocument.body.querySelector(`#${id}`);
const guideOverlay = guideDocument.createElement("div");
guideOverlay.id = "tutorial-overlay";
const guideCard = guideDocument.createElement("div");
guideCard.className = "tutorial-content";
const guideNext = guideDocument.createElement("button");
guideCard.append(guideNext);
const guideAfter = guideDocument.createElement("span");
guideOverlay.append(guideCard);
guideOverlay.append(guideAfter);
guideDocument.body.append(guideOverlay);
const guidePanel = guideDocument.createElement("dialog");
const guideHeader = guideDocument.createElement("header");
const guideCountry = guideDocument.createElement("select");
guideCountry.id = "campaign-country";
guidePanel.append(guideHeader);
guidePanel.append(guideCountry);
guideDocument.body.append(guidePanel);
let guideActive = true;
let guideAction = null;
const routedActions = [];
const guideBridge = createCampaignTutorialGuide({
	panel: guidePanel,
	anchor: guideHeader,
	documentRef: guideDocument,
	isActive: () => guideActive,
	getAction: () => guideAction,
	onAction: (target) => {
		routedActions.push(target);
		guidePanel.open = true;
		guideBridge.refresh();
		return guideCountry;
	},
});
const guideDock = guideDocument.getElementById("campaign-tutorial-guide");
const guideActionButton = guideDocument.getElementById(
	"campaign-tutorial-action",
);
guideBridge.refresh();
assert.equal(
	guideCard.parentNode,
	guideOverlay,
	"A closed dialog cannot steal the map tutorial",
);
assert.equal(
	guideActionButton.hidden,
	true,
	"Non-campaign tutorial pages have no action",
);
guideAction = {
	tab: "management",
	label: "CAMPAIGN_MANAGEMENT",
	controlId: "campaign-training-role",
};
guideBridge.refresh();
assert.equal(
	guideActionButton.hidden,
	false,
	"The floating tutorial has a route even when it covers the HUD menu",
);
guideActionButton.dispatchEvent(new Event("click"));
assert.equal(routedActions[0], guideAction);
assert.equal(guideCard.parentNode, guideDock);
assert.equal(
	guideDock.open,
	false,
	"A routed action collapses the guide to free the country controls",
);
assert.equal(guideDocument.activeElement, guideCountry);
guideAction = {
	tab: "operations",
	label: "CAMPAIGN_OPERATIONS",
	controlId: "campaign-mission",
};
guideBridge.refresh();
guideActionButton.dispatchEvent(new Event("click"));
assert.equal(
	routedActions[1].tab,
	"operations",
	"Actions route to the current page's section even while docked",
);
assert.equal(
	guideCard.children[0],
	guideNext,
	"Opening a section preserves the existing tutorial navigation",
);
guidePanel.open = false;
guidePanel.dispatchEvent(new Event("close"));
guidePanel.open = true;
guideBridge.refresh();
assert.equal(
	guideCard.parentNode,
	guideDock,
	"The original live tutorial must enter the native dialog's top layer",
);
assert.equal(guideDock.open, true);
assert.equal(guideDock.hidden, false);
assert.equal(
	guideCard.children[0],
	guideNext,
	"Navigation handlers and current content survive reparenting",
);
guideNext.focus();
guideDock.open = false;
guideDock.dispatchEvent(new Event("toggle"));
assert.equal(
	guideDocument.activeElement,
	guideDock.children[0],
	"Collapsing a focused guide keeps keyboard focus on its summary",
);
guideDocument.dispatchEvent(new Event("tutorialchange"));
assert.equal(
	guideDock.open,
	false,
	"Page changes and refreshes must respect manual collapse",
);
guidePanel.open = false;
guidePanel.dispatchEvent(new Event("close"));
assert.equal(guideCard.parentNode, guideOverlay);
assert.equal(
	guideOverlay.children[1],
	guideAfter,
	"Restoration preserves the original DOM position",
);
assert.equal(guideDock.hidden, true);
guidePanel.open = true;
guideBridge.refresh();
assert.equal(
	guideDock.open,
	true,
	"Reopening starts the active guide expanded",
);
guidePanel.dispatchEvent(new Event("close"));
assert.equal(
	guideCard.parentNode,
	guideDock,
	"A delayed close event cannot remove the guide from a reopened dialog",
);
guideNext.focus();
guideActive = false;
guideDocument.dispatchEvent(new Event("tutorialchange"));
assert.equal(guideActionButton.hidden, true);
assert.equal(guideCard.parentNode, guideOverlay);
assert.equal(
	guideDock.hidden,
	true,
	"Finish and Skip remove the empty guide area immediately",
);
assert.equal(
	guideDocument.activeElement,
	guideCountry,
	"Finishing the embedded tutorial returns focus to usable country controls",
);
guideActive = true;
guideDocument.dispatchEvent(new Event("tutorialchange"));
assert.equal(
	guideCard.parentNode,
	guideDock,
	"Starting help while a dialog is open remains visible",
);
guideBridge.restore();
assert.equal(
	guideCard.parentNode,
	guideOverlay,
	"An invalidated dialog restores the map tutorial before closing",
);
guideBridge.refresh();
guideBridge.destroy();
assert.equal(
	guideCard.parentNode,
	guideOverlay,
	"Destroy restores the live tutorial before removing the dialog",
);
assert.equal(guideDocument.getElementById("campaign-tutorial-guide"), null);
guideDocument.dispatchEvent(new Event("tutorialchange"));
assert.equal(
	guideCard.parentNode,
	guideOverlay,
	"Destroyed bridges remove their listeners",
);

const actionRuntime = {
	gameState: "SIMULATING",
	campaign: { enabled: true },
	tutorialActive: true,
	currentTutorialStep: 0,
	activeTutorialSet: [],
};
for (const [content, tab, controlId] of [
	["GAME_TUTORIAL_5_CONTENT", "overview", "campaign-country"],
	["GAME_TUTORIAL_FORCES_CONTENT", "overview", "campaign-country"],
	["GAME_TUTORIAL_ECONOMY_CONTENT", "management", "campaign-training-role"],
	["GAME_TUTORIAL_CITIES_CONTENT", "management", "campaign-city"],
	["GAME_TUTORIAL_MOBILIZATION_CONTENT", "management", "campaign-mobilization"],
	["GAME_TUTORIAL_MISSIONS_CONTENT", "operations", "campaign-mission"],
	["GAME_TUTORIAL_JOURNAL_CONTENT", "journal", "campaign-event-country"],
]) {
	actionRuntime.activeTutorialSet = [{ content }];
	assert.equal(campaignTutorialAction(actionRuntime)?.tab, tab);
	assert.equal(campaignTutorialAction(actionRuntime)?.controlId, controlId);
	assert.equal(
		actionRuntime.currentTutorialStep,
		0,
		"Routing must not advance or reset the current step",
	);
}
for (const content of [
	"GAME_TUTORIAL_0_CONTENT",
	"GAME_TUTORIAL_6_CONTENT",
	"GAME_TUTORIAL_SESSION_CONTENT",
]) {
	actionRuntime.activeTutorialSet = [{ content }];
	assert.equal(
		campaignTutorialAction(actionRuntime),
		null,
		"Setup/editor/session pages do not offer unrelated campaign actions",
	);
}
actionRuntime.activeTutorialSet = [
	{ content: "GAME_TUTORIAL_ECONOMY_CONTENT" },
];
assert.equal(
	campaignTutorialAction({ ...actionRuntime, tutorialActive: false }),
	null,
);
assert.equal(
	campaignTutorialAction({ ...actionRuntime, campaign: null }),
	null,
);

for (const status of ["starting", "idle", "suspended", "error"]) {
	assert.equal(
		campaignOrdersReady({ simulationClient: { diagnostics: { status } } }),
		false,
		`Orders must wait while the owner is ${status}`,
	);
}
assert.equal(
	campaignOrdersReady({
		simulationClient: { diagnostics: { status: "ready" } },
	}),
	true,
);
assert.equal(
	campaignOrdersReady({ simulationClient: {} }),
	true,
	"Lightweight clients without diagnostics remain supported",
);

for (const state of ["SELECTING_P1", "SELECTING_P2"]) {
	assert.deepEqual(
		campaignPanelState({
			gameState: state,
			campaign: { enabled: true, finished: true },
		}),
		{ visible: true, editable: false },
		"Final journal survives the treaty-to-setup transition",
	);
	assert.deepEqual(
		campaignPanelState({ gameState: state, campaign: { enabled: true } }),
		{ visible: false, editable: false },
		"An unfinished ledger must not leak into ordinary setup",
	);
}
assert.deepEqual(
	campaignPanelState({ gameState: "SIMULATING", campaign: { enabled: true } }),
	{ visible: true, editable: true },
);
assert.deepEqual(
	campaignPanelState({
		gameState: "SIMULATING",
		campaign: { enabled: true, finished: true },
	}),
	{ visible: true, editable: false },
);
assert.deepEqual(
	campaignPanelState({ gameState: "WAR_OVER", campaign: { enabled: true } }),
	{ visible: true, editable: false },
);
for (const state of [
	"MAIN_MENU",
	"EDITOR_ACTIVE",
	"SELECTING_P1",
	"SIMULATING",
]) {
	assert.deepEqual(
		campaignPanelState({ gameState: state, campaign: null }),
		{ visible: false, editable: false },
		"Clearing the ledger on a new scenario hides its panel",
	);
}
assert.deepEqual(
	campaignPanelState({
		gameState: "MAIN_MENU",
		campaign: { enabled: true, finished: true },
	}),
	{ visible: false, editable: false },
);

const renderText =
	(language) =>
	(key, parameters = {}) => {
		const message = CAMPAIGN_TRANSLATIONS[language][key];
		assert.equal(
			typeof message,
			"string",
			`Missing ${language} translation: ${key}`,
		);
		return message.replace(/\{(\w+)\}/g, (placeholder, name) =>
			Object.hasOwn(parameters, name) ? String(parameters[name]) : placeholder,
		);
	};

for (const language of ["uk", "ru"]) {
	assert.deepEqual(
		Object.keys(CAMPAIGN_TRANSLATIONS[language]),
		Object.keys(CAMPAIGN_TRANSLATIONS.en),
	);
	for (const [key, message] of Object.entries(
		CAMPAIGN_TRANSLATIONS[language],
	)) {
		assert.ok(
			message.trim().length > 0,
			`${language} ${key} must not be empty`,
		);
		const placeholders = (text) =>
			[...text.matchAll(/\{\w+\}/g)].map((match) => match[0]).sort();
		assert.deepEqual(
			placeholders(message),
			placeholders(CAMPAIGN_TRANSLATIONS.en[key]),
			`${language} ${key} must preserve parameters`,
		);
	}
}

// Render the production summary nodes across country, language and lifecycle changes.
{
	let language = "en";
	const documentRef = {
		createElement() {
			const node = new GuideNode(documentRef);
			Object.defineProperty(node, "innerHTML", {
				set() {
					assert.fail(
						"AI decision rendering must never parse scenario text as HTML",
					);
				},
			});
			return node;
		},
	};
	const summary = createCampaignDecisionSummary({
		documentRef,
		translate: (key, params) => renderText(language)(key, params),
	});
	const field = (key) => summary.node.querySelector(`#campaign-ai-${key}`);
	const state = {
		gameState: "SIMULATING",
		campaign: { enabled: true, period: 40 },
		countryMetadata: [{ id: 2, displayName: '<img src=x onerror="alert(1)">' }],
	};
	const country = {
		id: 1,
		automation: true,
		cities: [{ id: 7, name: "<script>test</script>" }],
		aiDecision: {
			period: 12,
			action: "train",
			reason: "air_threat",
			role: "airDefense",
			targetCountryId: 2,
			cityId: 7,
			reserveTarget: 120,
			projectedBalance: -20,
		},
	};
	for (const nextLanguage of ["en", "uk", "ru"]) {
		language = nextLanguage;
		summary.render(country, state);
		const translate = renderText(language);
		assert.equal(
			field("action").textContent,
			translate("CAMPAIGN_AI_ACTION_train"),
		);
		assert.equal(
			field("reason").textContent,
			translate("CAMPAIGN_AI_REASON_air_threat"),
		);
		assert.equal(
			field("period").textContent,
			translate("CAMPAIGN_AI_LAST_CYCLE", { count: 12 }),
		);
		assert.match(
			field("context").textContent,
			/<img src=x onerror="alert\(1\)">/,
		);
		assert.match(field("context").textContent, /<script>test<\/script>/);
		assert.equal(field("context").children.length, 0);
		assert.equal(field("budget").hidden, false);
		assert.match(field("budget").children[1].textContent, /-20/);
		assert.doesNotMatch(
			field("budget").children[1].textContent,
			/CAMPAIGN_|\{\w+\}/,
		);
		for (const key of Object.keys(CAMPAIGN_TRANSLATIONS.en).filter((key) =>
			key.startsWith("CAMPAIGN_AI_REASON_"),
		)) {
			country.aiDecision.reason = key.slice("CAMPAIGN_AI_REASON_".length);
			summary.render(country, state);
			assert.doesNotMatch(field("reason").textContent, /CAMPAIGN_|\{\w+\}/);
		}
		for (const action of [
			"wait",
			"build",
			"train",
			"production",
			"mobilize",
			"mission",
		]) {
			country.aiDecision.action = action;
			summary.render(country, state);
			assert.equal(
				field("action").textContent,
				translate(`CAMPAIGN_AI_ACTION_${action}`),
			);
		}
		country.aiDecision.reason = "air_threat";
		country.aiDecision.action = "train";
	}
	language = "en";
	summary.render({ ...country, automation: false }, state);
	assert.equal(field("state").textContent, renderText("en")("CAMPAIGN_AI_OFF"));
	for (const key of ["action", "reason", "context", "period", "budget"]) {
		assert.equal(
			field(key).hidden,
			true,
			"Disabling automation clears stale intent",
		);
	}
	summary.render({ id: 3, automation: true }, state);
	assert.equal(
		field("action").textContent,
		renderText("en")("CAMPAIGN_AI_PENDING"),
	);
	assert.equal(
		field("context").textContent,
		"",
		"Country changes cannot retain the previous target",
	);
	assert.equal(field("period").hidden, true);
	assert.equal(field("budget").hidden, true);
	country.aiDecision = {
		period: 20,
		action: "future_action",
		reason: "untrusted_reason",
		role: "<script>",
	};
	summary.render(country, state);
	assert.equal(
		field("action").textContent,
		renderText("en")("CAMPAIGN_AI_ACTION_UNKNOWN"),
	);
	assert.equal(
		field("reason").textContent,
		renderText("en")("CAMPAIGN_AI_REASON_UNKNOWN"),
	);
	assert.equal(field("context").textContent, "");
	state.campaign.finished = true;
	summary.render({ ...country, automation: false }, state);
	assert.equal(
		field("state").textContent,
		renderText("en")("CAMPAIGN_AI_FINISHED"),
	);
	assert.equal(
		field("period").hidden,
		false,
		"Completed campaigns retain the last recorded decision",
	);
	summary.render({ id: 3, automation: true }, state);
	assert.equal(
		field("action").textContent,
		renderText("en")("CAMPAIGN_AI_NONE"),
	);
	summary.render(null, state);
	assert.equal(summary.node.hidden, true);
	assert.equal(field("reason").textContent, "");
}

const units = [
	{ sovereignId: 1, health: 90, personnel: 800, campaignRole: "infantry" },
	{ sovereignId: 1, health: 30, personnel: 250, campaignRole: "armor" },
	{ sovereignId: 1, health: 100, personnel: 600 },
	{ sovereignId: 1, health: 0, personnel: 20, campaignRole: "artillery" },
	{ sovereignId: 1, health: 20, personnel: 0 },
	{ sovereignId: 1, kind: "transport", health: 100, personnel: 1000 },
	{ sovereignId: 2, health: 100, personnel: 15000, campaignRole: "infantry" },
];
const totals = campaignForceTotals(units, "1");
assert.equal(totals.formations, 3);
assert.equal(
	totals.personnel,
	1650,
	"Personnel must use current people, not flags times a nominal 1000",
);
assert.deepEqual(totals.roles, {
	infantry: 2,
	armor: 1,
	artillery: 0,
	airDefense: 0,
});
assert.deepEqual(campaignForceTotals([], 1), {
	formations: 0,
	personnel: 0,
	roles: { infantry: 0, armor: 0, artillery: 0, airDefense: 0 },
});

const finalForces = {
	formations: 2,
	personnel: 1234,
	roles: { infantry: 1, armor: 1, artillery: 0, airDefense: 0 },
};
const retainedCountry = {
	id: 1,
	formations: 3,
	deployed: 1500,
	roleCounts: { infantry: 2, armor: 1 },
};
assert.equal(
	campaignDisplayedForces(
		{
			gameState: "SELECTING_P1",
			campaign: {
				enabled: true,
				finished: true,
				finalForces: { 1: finalForces },
			},
			units: [],
		},
		retainedCountry,
	),
	finalForces,
	"Final counts survive the map clearing deployed units during setup",
);
assert.deepEqual(
	campaignDisplayedForces(
		{ gameState: "WAR_OVER", campaign: { enabled: true }, units: [] },
		retainedCountry,
	),
	{ formations: 3, personnel: 1500, roles: retainedCountry.roleCounts },
	"Older ledgers still expose explicitly labelled last recorded totals",
);
assert.deepEqual(
	campaignDisplayedForces(
		{ gameState: "SIMULATING", campaign: { enabled: true }, units },
		retainedCountry,
	),
	totals,
	"A live battle always uses current mirror totals",
);

const events = [
	{
		id: 1,
		tick: 120,
		type: "training_started",
		countryId: 1,
		role: "infantry",
	},
	{
		id: 2,
		tick: 240,
		type: "production_started",
		countryId: 2,
		equipment: "aircraft",
	},
	{
		id: 3,
		tick: 360,
		type: "city_captured",
		countryId: 2,
		previousCountryId: 1,
		cityName: "Kyiv",
	},
	{
		id: 4,
		tick: 480,
		type: "mission",
		countryId: 2,
		targetCountryId: 1,
		mission: "reconDrone",
	},
	{ id: 5, tick: 600, type: "dependency_changed", countryId: 3, overlordId: 1 },
];
assert.deepEqual(
	selectCampaignEvents(events, { countryId: 1 }).map((event) => event.id),
	[5, 4, 3, 1],
);
assert.deepEqual(
	selectCampaignEvents(events, { countryId: 1, category: "territory" }).map(
		(event) => event.id,
	),
	[3],
);
assert.equal(selectCampaignEvents(events, { limit: 0 }).length, 0);
assert.equal(
	selectCampaignEvents(
		Array.from({ length: 240 }, (_, id) => ({ id, type: "training_started" })),
		{ limit: 500 },
	).length,
	100,
);
assert.equal(campaignEventCategory("region_control_changed"), "territory");
assert.equal(campaignEventCategory("country_capitulated"), "diplomacy");
assert.equal(campaignEventCategory("order_cancelled"), "economy");
assert.deepEqual(
	selectCampaignEvents([{ id: 6, type: "peace_signed" }], {
		countryId: 99,
	}).map((event) => event.id),
	[6],
	"Global treaty outcomes remain visible under a country filter",
);

const runtime = {
	countryMetadata: [
		{ id: 1, displayName: "Україна" },
		{ id: 2, displayName: "Росія" },
	],
	campaign: { countries: { 1: { cities: [{ id: "kyiv", name: "Київ" }] } } },
};
const cityEvent = {
	type: "city_captured",
	countryId: 1,
	previousCountryId: 2,
	cityId: "kyiv",
};
for (const language of ["en", "uk", "ru"]) {
	const translate = renderText(language);
	for (const event of [
		...events,
		cityEvent,
		{
			type: "building_completed",
			countryId: 1,
			cityId: "kyiv",
			building: "industry",
		},
		{ type: "training_completed", countryId: 1, role: "airDefense" },
		{ type: "production_completed", countryId: 1, equipment: "strikeDrone" },
		{ type: "mobilization", countryId: 1, level: 2 },
		{ type: "policy", countryId: 1, policy: "economy" },
		{ type: "shortage", countryId: 1, reason: "supplies" },
		{
			type: "region_control_changed",
			countryId: 1,
			regionNames: { en: "Kherson" },
			control: "majority",
			share: 0.8,
		},
		{ type: "order_cancelled", countryId: 1 },
		{ type: "peace_signed" },
		{ type: "future_unknown_event", countryId: 1 },
	]) {
		assert.doesNotMatch(
			formatCampaignEvent(event, runtime, translate),
			/CAMPAIGN_|\{\w+\}/,
		);
	}
	for (const reason of [
		"disabled",
		"invalid_command",
		"invalid_country",
		"invalid_role",
		"invalid_quantity",
		"queue_full",
		"no_city",
		"formation_cap",
		"funds",
		"manpower",
		"equipment",
		"invalid_building",
		"max_level",
		"invalid_equipment",
		"invalid_mission",
		"invalid_target",
		"bombs_disabled",
		"mission_busy",
		"supplies",
		"no_formation",
		"invalid_level",
		"invalid_policy",
		"invalid_order",
		"connection",
		"timeout",
		"unavailable",
		"inactive_game",
		"arbitrary-server-message",
	]) {
		assert.doesNotMatch(
			campaignOrderError(reason, translate),
			/CAMPAIGN_|\{\w+\}|arbitrary-server-message/,
		);
	}
}
assert.match(
	formatCampaignEvent(cityEvent, runtime, renderText("uk")),
	/Україна.*Київ.*Росія/,
);
assert.match(
	formatCampaignEvent(
		{ type: "shortage", countryId: 1, reason: "supplies" },
		runtime,
		renderText("uk"),
	),
	/нестача забезпечення/,
);
assert.match(
	formatCampaignEvent(
		{ type: "dependency_changed", countryId: 1, overlordId: 0 },
		runtime,
		renderText("uk"),
	),
	/незалежна/,
);
assert.equal(
	campaignOrderError("timeout", renderText("uk")),
	campaignOrderError("connection", renderText("uk")),
);
assert.equal(
	campaignOrderError("unavailable", renderText("uk")),
	campaignOrderError("connection", renderText("uk")),
);
assert.match(
	formatCampaignEvent(
		{
			type: "region_control_changed",
			regionNames: { en: "Kherson" },
			countryId: 0,
			controllerId: 2,
			control: "contested",
			share: 0.42,
		},
		runtime,
		renderText("uk"),
	),
	/Росія, 42%/,
);

console.log(
	"Campaign UI: current formation/personnel totals, role counts, bounded country/category journal filters, localized events and all command errors passed.",
);
