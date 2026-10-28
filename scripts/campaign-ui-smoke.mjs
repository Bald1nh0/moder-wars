import assert from "node:assert/strict";
import {
	campaignDisplayedForces,
	campaignEventCategory,
	campaignForceTotals,
	campaignOrderError,
	campaignOrdersReady,
	campaignPanelState,
	formatCampaignEvent,
	selectCampaignEvents,
} from "../src/campaign-ui.js";
import { CAMPAIGN_TRANSLATIONS } from "../src/translations-campaign.js";

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
