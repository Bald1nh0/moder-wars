import assert from "node:assert/strict";
import {
	buildCampaignRegionIndex,
	emitCampaignEvent,
	recordCampaignCapitulation,
	resetCampaignEvents,
	updateCampaignEvents,
} from "../src/campaign-events.js";
import { COUNTRY_FORCE_DATA } from "../src/country-force-data.js";
import {
	getCountryForceProfile,
	getCountryForceProfiles,
	normalizeCountryDependency,
	normalizeCountryIso3,
	normalizeForceProfile,
	normalizeScenarioDate,
	resolveCountryRelationship,
} from "../src/country-force-profiles.js";

assert(Object.keys(COUNTRY_FORCE_DATA.countries).length >= 200);
assert(
	Object.values(COUNTRY_FORCE_DATA.countries).filter(
		(country) => country.personnel.length,
	).length >= 150,
);
assert.equal(normalizeCountryIso3({ iso2: "ua" }), "UKR");
assert.equal(
	normalizeCountryIso3({ name: "People's Republic of China" }),
	"CHN",
);
assert.equal(
	normalizeCountryIso3({
		name: "custom",
		flagUrl: "https://flagcdn.com/w320/gb.png",
	}),
	"GBR",
);
assert.equal(normalizeCountryIso3({ name: "unknown fictional country" }), null);
assert.equal(normalizeScenarioDate("2026-02-30"), null);
assert.equal(
	normalizeScenarioDate({ year: 2023, month: 1, day: 1 }),
	"2023-01-01",
);
const ukraine = getCountryForceProfile({ iso2: "UA" }, "2023-01-01");
assert.equal(ukraine.personnel.asOf, "2020-12-31");
assert.equal(ukraine.personnel.license, "CC-BY-4.0");
assert.equal(ukraine.personnel.status, "active_including_paramilitary");
assert(ukraine.personnel.definition.includes("reserves excluded"));
assert.equal(ukraine.equipment.tank, null);
assert.equal(
	getCountryForceProfile({ iso2: "UA" }, "2017-01-01").personnel,
	null,
);
assert.equal(
	getCountryForceProfile({ iso2: "GB" }, "2023-01-01").equipment.artillery,
	null,
);
const uk = getCountryForceProfile({ iso2: "GB" }, "2026-10-21");
assert.equal(uk.equipment.artillery.value, 219);
assert.equal(uk.equipment.aircraftTotal.value, 507);
assert.equal(uk.equipment.combatAircraft, null);
assert.equal(uk.equipment.artillery.sourceDate, "2026-08-20");
assert.equal(uk.equipment.artillery.license, "OGL-3.0");
assert.equal(getCountryForceProfile({ iso2: "UA" }, "invalid").personnel, null);
for (const code of Object.keys(COUNTRY_FORCE_DATA.countries)) {
	const profile = getCountryForceProfile({ iso3: code }, "2023-01-01");
	for (const observation of [
		profile.personnel,
		...Object.values(profile.equipment),
		...Object.values(profile.economy),
	]) {
		if (!observation) continue;
		assert(observation.asOf <= "2023-01-01");
		assert(Number.isFinite(observation.value) && observation.value >= 0);
		assert(observation.sourceUrl.startsWith("https://"));
	}
}
assert.equal(
	getCountryForceProfiles([{ id: 7, iso2: "UA" }], "2023-01-01")[7].iso3,
	"UKR",
);
const imported = normalizeForceProfile({
	iso3: "UKR",
	personnel: { ...ukraine.personnel, value: 0 },
	equipment: {
		tank: { ...uk.equipment.artillery, value: NaN },
		artillery: { ...uk.equipment.artillery, sourceUrl: "javascript:alert(1)" },
	},
	gameAssumptions: {
		personnel: 1000,
		equipment: { armor: 25 },
		__proto__: { untrusted: true },
	},
	extra: "untrusted",
});
assert.equal(
	imported.personnel.value,
	0,
	"A sourced zero differs from missing data",
);
assert.equal(imported.equipment.tank, null);
assert.equal(imported.equipment.artillery, null);
assert.equal(imported.extra, undefined);
assert.equal(imported.gameAssumptions.equipment.armor, 25);
assert.deepEqual(
	normalizeForceProfile(JSON.parse(JSON.stringify(imported))),
	imported,
);
assert.equal(
	getCountryForceProfile({ forceProfile: imported }, "2019-01-01").personnel,
	null,
);
const countries = [
	{ id: 1, iso2: "GL" },
	{ id: 2, iso2: "DK" },
	{ id: 3, iso2: "US" },
];
const relationship = resolveCountryRelationship(
	{ ...countries[0], overlordId: 3 },
	countries,
	"2026-10-21",
);
assert.equal(relationship.legal.type, "self_governing_realm");
assert.equal(relationship.legal.controllerId, 2);
assert.equal(relationship.game.controllerId, 3);
assert.equal(
	resolveCountryRelationship(
		{ name: "Belarus", allies: [3] },
		countries,
		"2026-10-21",
	).legal,
	null,
);
assert.equal(normalizeCountryDependency({ type: "puppet" }), null);

function fixture() {
	const width = 360,
		height = 180;
	const control = new Uint16Array(width * height);
	const land = new Uint8Array(width * height);
	for (let y = 90; y < 92; y++)
		for (let x = 180; x < 184; x++) {
			control[y * width + x] = 1;
			land[y * width + x] = 1;
		}
	return {
		CONFIG: { GRID_RES: 1 },
		gridWidth: width,
		gridHeight: height,
		landMask: land,
		worldControlMap: control,
		primaryOccupierMap: new Uint16Array(control),
		_simTickCount: 0,
		cities: [
			{ name: "Capital", lat: 0.5, lng: 0.5, isCapital: true, sovereignId: 1 },
		],
		countryMetadata: [
			{ id: 1, name: "A" },
			{ id: 2, name: "B" },
		],
		sides: [[{ id: 1 }], [{ id: 2 }]],
		campaign: {
			version: 1,
			enabled: true,
			events: [],
			nextEventId: 1,
			scenarioDate: "2026-10-21",
			countries: { 1: {} },
		},
	};
}
const runtime = fixture();
updateCampaignEvents(runtime);
assert.equal(
	runtime.campaign.events.length,
	0,
	"The initial controller is a baseline, not a capture",
);
const capitalIndex = 90 * 360 + 180;
runtime.primaryOccupierMap[capitalIndex] = 2;
runtime._simTickCount = 59;
updateCampaignEvents(runtime);
assert.equal(runtime.campaign.events.length, 0);
runtime._simTickCount = 60;
updateCampaignEvents(runtime);
assert.deepEqual(runtime.campaign.events[0], {
	id: 1,
	tick: 60,
	type: "capital_captured",
	countryId: 2,
	previousCountryId: 1,
	cityId: "city-0",
	cityName: "Capital",
});
runtime.campaign = JSON.parse(JSON.stringify(runtime.campaign));
runtime._simTickCount = 120;
updateCampaignEvents(runtime);
assert.equal(
	runtime.campaign.events.length,
	1,
	"Handoff must not replay captures",
);
runtime.countryMetadata[0].overlordId = 2;
runtime.countryMetadata[0].releasableBy = 2;
runtime.sides[0] = [];
runtime._simTickCount = 180;
updateCampaignEvents(runtime);
assert(
	runtime.campaign.events.some((event) => event.type === "country_capitulated"),
);
assert(
	runtime.campaign.events.some((event) => event.type === "dependency_changed"),
);
assert.equal(
	runtime.campaign.countries[1].relationship.game.controllerId,
	2,
	"The panel relationship follows live diplomacy",
);
for (let i = 0; i < 250; i++)
	emitCampaignEvent(runtime, "mobilization", {
		countryId: 1,
		quantity: i,
		id: -1,
		cityName: "<script>unsafe</script>",
		extra: { huge: "ignored" },
	});
assert.equal(runtime.campaign.events.length, 200);
assert.equal(runtime.campaign.events.at(-1).id, 253);
assert.equal(runtime.campaign.events.at(-1).extra, undefined);
assert(!runtime.campaign.events.at(-1).cityName.includes("<"));
const before = runtime.campaign.events.length;
assert.equal(emitCampaignEvent(runtime, "unrecognized", {}), null);
assert.equal(runtime.campaign.events.length, before);
runtime._simTickCount = 0;
updateCampaignEvents(runtime);
assert.equal(
	runtime.campaign.events.length,
	0,
	"Rewinding a session resets its stale journal",
);
assert.equal(runtime.campaign.nextEventId, 1);

const ended = fixture();
updateCampaignEvents(ended);
recordCampaignCapitulation(ended, ended.countryMetadata[0], 2);
ended.countryMetadata[0].releasableBy = 2;
ended.sides[0] = [];
emitCampaignEvent(ended, "peace_signed", { reason: "FULL_CAPITULATION" });
assert.equal(
	ended.campaign.events[0].type,
	"country_capitulated",
	"The terminal transition does not wait for another simulation tick",
);
assert.equal(ended.campaign.events[1].type, "peace_signed");
ended._simTickCount = 60;
updateCampaignEvents(ended);
assert.equal(
	ended.campaign.events.filter((event) => event.type === "country_capitulated")
		.length,
	1,
	"Polling does not duplicate the authoritative capitulation event",
);

const regional = fixture();
regional.cities = [];
const geometry = [
	{
		id: "UA-test",
		country: "UKR",
		names: { en: "Test Oblast", uk: "Тестова область" },
		bbox: [0, 0, 4, 2],
		rings: [[0, 0, 4, 0, 4, 2, 0, 2, 0, 0]],
	},
];
regional.campaign.regions = buildCampaignRegionIndex(regional, geometry);
assert.equal(regional.campaign.regions.regions[0].cells.length, 8);
// Restored cursors are numeric indices, not inherited properties on the array.
regional.campaign.regions.cursor = "__proto__";
regional.campaign.regions.regions[0].cursor = "constructor";

updateCampaignEvents(regional);
assert.equal(regional.campaign.events.length, 0);
regional.primaryOccupierMap[capitalIndex] = 2;
for (const tick of [60, 120]) {
	regional._simTickCount = tick;
	updateCampaignEvents(regional);
}
assert(
	!regional.campaign.events.some(
		(event) => event.control === "full" && event.countryId === 2,
	),
	"One cell cannot capture an oblast",
);
assert.equal(regional.campaign.regions.regions[0].summary.control, "majority");
for (const cell of regional.campaign.regions.regions[0].cells)
	regional.primaryOccupierMap[cell] = 2;
regional._simTickCount = 180;
updateCampaignEvents(regional);
assert.equal(
	regional.campaign.regions.regions[0].summary.countryId,
	1,
	"A new region controller needs a second complete pass",
);
regional.campaign = structuredClone(regional.campaign);
regional._simTickCount = 240;
updateCampaignEvents(regional);
assert.equal(regional.campaign.events.at(-1).type, "region_control_changed");
assert.equal(regional.campaign.events.at(-1).countryId, 2);
assert.equal(regional.campaign.events.at(-1).share, 1);
assert.equal(regional.campaign.events.at(-1).control, "full");
for (const cell of regional.campaign.regions.regions[0].cells.slice(0, 3))
	regional.primaryOccupierMap[cell] = 1;
for (const tick of [300, 360]) {
	regional._simTickCount = tick;
	updateCampaignEvents(regional);
}
assert.equal(regional.campaign.events.at(-1).control, "contested");
assert.equal(
	regional.campaign.events.at(-1).countryId,
	0,
	"Contested territory has no established region owner",
);
assert.equal(
	regional.campaign.events.at(-1).controllerId,
	2,
	"The largest controlling side remains available for the notification label",
);
assert.equal(regional.campaign.regions.regions[0].summary.controllerId, 2);
assert.throws(
	() => buildCampaignRegionIndex(regional, geometry, { maxCells: 1 }),
	/budget/,
);
const borders = fixture();
borders.countryMetadata[0].iso3 = "UKR";
borders.deJureMap = new Uint16Array(borders.worldControlMap);
borders.deJureMap[capitalIndex] = 2;
assert.equal(
	buildCampaignRegionIndex(borders, geometry).regions[0].cells.length,
	7,
	"Geographic source mismatch must not add a neighboring country's cell",
);
resetCampaignEvents(regional);
assert.equal(regional.campaign.regions.regions[0].summary, null);
assert.equal(regional.campaign.events.length, 0);
console.log(
	"campaign-data-smoke: dated observations, unknown values, provenance, relationships, bounded events and region control passed",
);
