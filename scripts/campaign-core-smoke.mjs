import assert from "node:assert/strict";
import { createArmyFormation } from "../src/army-formation.js";
import {
	advanceCampaign,
	CAMPAIGN_PERIOD_TICKS,
	CAMPAIGN_QUEUE_LIMIT,
	commandCampaign,
	initializeCampaign,
	reconcileCampaignMembership,
	roleModifiers,
} from "../src/campaign-core.js";
import { CONFIG } from "../src/config.js";
import { createSimulationCore } from "../src/simulation-core.js";
import { createTinySimulationState } from "./simulation-fixture.mjs";

function fixture({ allied = false, maxUnits = 8 } = {}) {
	const runtime = {
		CONFIG: { ...CONFIG, MAX_UNITS_PER_SIDE: maxUnits },
		MAX_SIDES: 2,
		_simTickCount: 0,
		gameState: "SIMULATING",
		sides: allied
			? [
					[
						{ id: 1, troops: 3000 },
						{ id: 2, troops: 1000 },
					],
					[],
				]
			: [[{ id: 1, troops: 3000 }], [{ id: 2, troops: 1000 }]],
		countryMetadata: [
			{ id: 1, pop: 100_000 },
			{ id: 2, pop: 100_000 },
		],
		units: [1, 2].map((id) =>
			createArmyFormation({
				id,
				lat: 0,
				lng: id,
				sideIndex: allied ? 0 : id - 1,
				sovereignId: id,
				health: 100,
				maxHealth: 100,
				personnel: 1000,
				personnelCapacity: 1000,
				deployTicks: 0,
			}),
		),
		cities: [1, 2].map((id) => ({
			id,
			name: `City ${id}`,
			lat: 0,
			lng: id,
			sovereignId: id,
		})),
		worldControlMap: new Uint16Array([1, 2]),
		primaryOccupierMap: new Uint16Array([1, 2]),
		getGridIndex: (_lat, lng) => lng - 1,
		sideRecruitableManpower: new Float64Array([6000, allied ? 0 : 6000]),
		sideSoldiers: new Float64Array([allied ? 8000 : 7000, allied ? 0 : 7000]),
		initialSideSoldiers: new Float64Array([
			allied ? 8000 : 7000,
			allied ? 0 : 7000,
		]),
		areSidesHostile: (a, b) => a !== b,
	};
	initializeCampaign(runtime);
	for (const country of Object.values(runtime.campaign.countries))
		country.automation = false;
	return runtime;
}

// Fictional stocks vary by force size, while source observations do not become inventory.
{
	const runtime = fixture();
	runtime.units[0].personnel = 100_000;
	initializeCampaign(runtime, {
		profiles: {
			1: {
				personnel: { value: 900_000, asOf: "2020" },
				gameAssumptions: { equipment: { aircraft: null } },
			},
			2: {
				gameAssumptions: {
					treasury: 500,
					civilianPool: 0,
					baseIncome: 70,
					equipment: { aircraft: 0, armor: 8, missile: 1e9, artillery: NaN },
				},
			},
		},
	});
	assert.ok(
		runtime.campaign.countries[1].equipment.armor >
			runtime.campaign.countries[2].equipment.armor,
	);
	assert.ok(runtime.campaign.countries[1].equipment.aircraft > 0);
	assert.equal(runtime.campaign.countries[2].equipment.aircraft, 0);
	assert.equal(runtime.campaign.countries[2].equipment.armor, 8);
	assert.equal(runtime.campaign.countries[2].equipment.missile, 10_000);
	assert.equal(runtime.campaign.countries[2].equipment.artillery, 18);
	assert.equal(runtime.campaign.countries[2].treasury, 500);
	assert.equal(runtime.campaign.countries[2].civilianPool, 0);
	assert.equal(runtime.campaign.countries[1].deployed, 100_000);
}

// Cancellation cannot duplicate personnel or equipment, and has a sunk cost.
{
	const runtime = fixture();
	const country = runtime.campaign.countries[1];
	const funds = country.treasury;
	assert.equal(issue(runtime, "train", { role: "armor" }).ok, true);
	const orderId = country.queue[0].id;
	assert.equal(issue(runtime, "cancel", { orderId }).ok, true);
	assert.equal(country.queue.length, 0);
	assert.equal(country.treasury, funds - 75);
	assert.equal(country.reserve, 6000);
	assert.equal(country.equipment.armor, 30);
	assert.equal(issue(runtime, "cancel", { orderId }).reason, "invalid_order");
	assert.equal(runtime.sideRecruitableManpower[0], 6000);
}

// Diplomacy moves complete ledgers and keeps pooled reserves exact across allies.
{
	const runtime = fixture({ allied: true });
	assert.equal(issue(runtime, "train", { role: "infantry" }).ok, true);
	const country = runtime.campaign.countries[1];
	const funds = country.treasury;
	const queue = country.queue;
	runtime.sides[1].push(runtime.sides[0].shift());
	// Deliberately imitate the old proportional reserve transfer: reconciliation
	// must use the country's actual reserve instead of this approximation.
	runtime.sideRecruitableManpower.set([2500, 2500]);
	assert.equal(reconcileCampaignMembership(runtime), true);
	assert.equal(country.sideIndex, 1);
	assert.equal(country.treasury, funds);
	assert.equal(country.queue, queue);
	assert.equal(runtime.units[0].sideIndex, 1);
	assert.equal(runtime.sideRecruitableManpower[1], 3500);
	assert.equal(runtime.sideRecruitableManpower[0], 1500);
	assert.equal(runtime.sideSoldiers[1], 5500);
	assert.equal(runtime.sideSoldiers[0], 2500);
	runtime.sides[0] = [];
	runtime.units = runtime.units.filter((unit) => unit.sovereignId !== 2);
	reconcileCampaignMembership(runtime);
	assert.equal(runtime.sideRecruitableManpower[0], 0);
	assert.equal(runtime.campaign.countries[2].active, false);
	assert.equal(
		commandCampaign(runtime, {
			type: "campaign",
			countryId: 2,
			action: "mobilize",
			level: 1,
		}).reason,
		"invalid_country",
	);
	// A first-time entrant gets only the additional legacy reserve contribution.
	runtime.campaign.scenarioDate = "2023-01-01";
	runtime.countryMetadata.push({
		id: 3,
		name: "Ukraine",
		iso3: "UKR",
		pop: 50_000,
	});
	runtime.sides[1].push({ id: 3, troops: 1000 });
	runtime.sideRecruitableManpower[1] += 2000;
	runtime.units.push(
		createArmyFormation({
			id: 3,
			lat: 0,
			lng: 2,
			sovereignId: 3,
			sideIndex: 1,
			personnel: 1000,
			personnelCapacity: 1000,
		}),
	);
	reconcileCampaignMembership(runtime);
	assert.equal(runtime.campaign.countries[3].reserve, 2000);
	assert.equal(runtime.campaign.countries[3].profile.iso3, "UKR");
	assert.ok(runtime.campaign.countries[3].profile.personnel.value > 0);
	assert.ok(
		runtime.campaign.countries[3].profile.personnel.asOf <= "2023-01-01",
	);
	assert.equal(country.reserve, 3500);
	assert.equal(runtime.sideRecruitableManpower[1], 5500);
	assert.equal(runtime.sideSoldiers[1], 8500);
	assert.equal(reconcileCampaignMembership(runtime), false);
	assert.equal(runtime.sideRecruitableManpower[1], 5500);
	runtime.gameState = "WAR_OVER";
	assert.equal(
		issue(runtime, "train", { role: "infantry" }).reason,
		"inactive_game",
	);
	assert.equal(advanceCampaign(runtime), false);
}

// Missions reserve bounded decorative flights, with no legacy impact damage.
{
	const runtime = fixture();
	runtime.bombs = [];
	runtime.launchBomb = (...coordinates) => runtime.bombs.push({ coordinates });
	assert.equal(
		issue(runtime, "mission", { mission: "missile", targetCountryId: 2 }).ok,
		true,
	);
	assert.equal(runtime.bombs.length, 1);
	assert.equal(runtime.bombs[0].campaignDecorative, true);
	assert.deepEqual(runtime.bombs[0].coordinates, [0, 1, 0, 2, 0]);
}

// The actual impact path must distinguish decorative campaign traces from
// legacy missiles; otherwise aggregate mission effects would be applied twice.
{
	function impact(decorative) {
		const core = createSimulationCore(createTinySimulationState());
		initializeCampaign(core.state);
		core.state.bombsDisabled = false;
		const target = core.state.units[1];
		core.state.bombs.push({
			id: 0.123,
			sideIndex: 0,
			startLat: 5,
			startLng: -5,
			targetLat: target.lat,
			targetLng: target.lng,
			currentLat: target.lat,
			currentLng: target.lng,
			nextLat: target.lat,
			nextLng: target.lng,
			peakAlt: 2,
			progress: 0.999,
			state: "falling",
			trail: [],
			campaignDecorative: decorative,
		});
		core.tick();
		assert.equal(core.state.bombs.length, 0);
		return target.health;
	}
	assert.ok(
		impact(true) > impact(false),
		"decorative traces cannot apply legacy bomb damage",
	);
}

// Exercise the real shared simulation owner: campaign ticks and legacy combat
// must preserve personnel totals for more than one complete training cycle.
{
	const core = createSimulationCore(createTinySimulationState());
	initializeCampaign(core.state);
	for (const country of Object.values(core.state.campaign.countries))
		country.automation = false;
	assert.equal(
		core.command({
			type: "campaign",
			countryId: 1,
			action: "train",
			role: "infantry",
		}).ok,
		true,
	);
	for (let tick = 0; tick < 720; tick++) assert.equal(core.tick(), true);
	assert.equal(core.state.campaign.period, 6);
	assert.equal(core.state.campaign.countries[1].queue.length, 0);
	for (const country of Object.values(core.state.campaign.countries)) {
		assert.equal(
			core.state.sideRecruitableManpower[country.sideIndex],
			country.reserve,
		);
		assert.equal(
			core.state.sideSoldiers[country.sideIndex],
			country.reserve + country.deployed,
		);
	}
}
function issue(runtime, action, fields = {}) {
	return commandCampaign(runtime, {
		type: "campaign",
		countryId: 1,
		action,
		...fields,
	});
}
function periods(runtime, number) {
	for (let index = 0; index < number; index++) {
		runtime._simTickCount += CAMPAIGN_PERIOD_TICKS;
		assert.equal(advanceCampaign(runtime), true);
	}
}

// The initial side reserve is apportioned exactly, not copied into every ally.
{
	const runtime = fixture({ allied: true });
	assert.equal(runtime.campaign.countries[1].reserve, 4500);
	assert.equal(runtime.campaign.countries[2].reserve, 1500);
	assert.equal(
		Object.values(runtime.campaign.countries).reduce(
			(sum, country) => sum + country.reserve,
			0,
		),
		runtime.sideRecruitableManpower[0],
	);
	const before = JSON.stringify(runtime.campaign);
	runtime._simTickCount = CAMPAIGN_PERIOD_TICKS - 1;
	assert.equal(advanceCampaign(runtime), false);
	assert.equal(JSON.stringify(runtime.campaign), before);
}

// Training reserves personnel once; deployment does not debit it a second time.
{
	const runtime = fixture();
	const country = runtime.campaign.countries[1];
	const initialFunds = country.treasury;
	assert.deepEqual(issue(runtime, "train", { role: "armor", quantity: 2 }), {
		ok: true,
		reason: "ok",
	});
	assert.equal(country.treasury, initialFunds - 600);
	assert.equal(country.equipment.armor, 10);
	assert.equal(country.reserve, 4000);
	assert.equal(runtime.sideRecruitableManpower[0], 4000);
	assert.equal(runtime.sideSoldiers[0], 7000);
	assert.equal(runtime.units.length, 2);
	periods(runtime, 5);
	assert.equal(runtime.units.length, 3);
	assert.equal(runtime.units.at(-1).campaignRole, "armor");
	assert.equal(runtime.units.at(-1).personnel, 1000);
	assert.equal(country.reserve, 4000);
	periods(runtime, 5);
	assert.equal(runtime.units.length, 4);
	assert.equal(country.queue.length, 0);
	assert.equal(runtime.sideSoldiers[0], country.reserve + country.deployed);
	const trained = runtime.units.at(-1);
	trained.personnel = 500;
	trained.health = 50;
	runtime.sideSoldiers[0] -= 500;
	assert.equal(issue(runtime, "demobilize", { unitId: trained.id }).ok, true);
	assert.equal(country.reserve, 4500);
	assert.equal(country.equipment.armor, 14);
	assert.equal(runtime.sideSoldiers[0], country.reserve + country.deployed);
}

// Resource failure and untrusted values cannot partially debit an order.
{
	const runtime = fixture();
	for (const invalid of [
		{ action: "train", role: "armor", quantity: 4 },
		{ action: "train", role: "infantry", quantity: -1 },
		{ action: "train", role: "infantry", quantity: NaN },
		{ action: "production", equipment: "missile", quantity: 1000000 },
		{ action: "production", equipment: "__proto__" },
		{ action: "mobilize", level: 3 },
		{ action: "policy", automation: "true" },
		{ action: "build", cityId: 2, building: "economy" },
		{ action: "mission", mission: "missile", targetCountryId: 1 },
	]) {
		const before = JSON.stringify(runtime.campaign);
		assert.equal(issue(runtime, invalid.action, invalid).ok, false);
		assert.equal(JSON.stringify(runtime.campaign), before);
	}
}

// Shared side limits include every ally's orders, and never allow excess flags.
{
	const runtime = fixture({ allied: true, maxUnits: 3 });
	assert.equal(issue(runtime, "train", { role: "infantry" }).ok, true);
	assert.equal(
		commandCampaign(runtime, {
			type: "campaign",
			action: "train",
			countryId: 2,
			role: "infantry",
		}).reason,
		"formation_cap",
	);
	periods(runtime, 10);
	assert.equal(runtime.units.length, 3);
}

// Building income starts on completion and follows captured cities, not sovereignty.
{
	const runtime = fixture();
	const country = runtime.campaign.countries[1];
	const startIncome = country.income;
	assert.equal(
		issue(runtime, "build", { cityId: 1, building: "economy" }).ok,
		true,
	);
	periods(runtime, 4);
	assert.equal(country.cities[0].buildings.economy, 1);
	periods(runtime, 1);
	assert.equal(country.income, startIncome + 35);
	runtime.primaryOccupierMap[0] = 2;
	periods(runtime, 1);
	assert.equal(country.cities.length, 0);
	assert.equal(country.income, 0);
	assert.equal(
		runtime.campaign.countries[2].cities.find((city) => city.id === 1).buildings
			.economy,
		1,
	);
	assert.equal(
		issue(runtime, "build", { cityId: 1, building: "supply" }).reason,
		"no_city",
	);
	assert.equal(issue(runtime, "train", { role: "infantry" }).reason, "no_city");
}

// Mobilization uses a finite civilian pool and has a visible economic cost.
{
	const runtime = fixture();
	const country = runtime.campaign.countries[1];
	const income = country.income;
	const pool = country.civilianPool;
	assert.equal(issue(runtime, "mobilize", { level: 2 }).ok, true);
	assert.ok(country.income < income);
	const reserve = country.reserve;
	periods(runtime, 1);
	assert.equal(country.reserve - reserve, 200);
	assert.equal(country.civilianPool, pool - 200);
	periods(runtime, 30);
	assert.equal(country.civilianPool, 0);
	assert.equal(country.reserve, reserve + pool);
	assert.equal(runtime.sideSoldiers[0], country.reserve + country.deployed);
}

// Equipment is produced over time. Missions reserve reusable assets or expend stock.
{
	const runtime = fixture();
	const country = runtime.campaign.countries[1];
	assert.equal(
		issue(runtime, "production", { equipment: "missile", quantity: 2 }).ok,
		true,
	);
	assert.equal(country.equipment.missile, 3);
	periods(runtime, 4);
	assert.equal(country.equipment.missile, 5);
	const own = runtime.units[0];
	const enemy = runtime.units[1];
	const ownAttack = roleModifiers(own, runtime).attack;
	const enemyAttack = roleModifiers(enemy, runtime).attack;
	assert.equal(
		issue(runtime, "mission", { mission: "aircraft", targetCountryId: 2 }).ok,
		true,
	);
	assert.equal(country.equipment.aircraft, 2);
	assert.ok(roleModifiers(own, runtime).attack > ownAttack);
	assert.equal(
		issue(runtime, "mission", { mission: "aircraft", targetCountryId: 2 })
			.reason,
		"mission_busy",
	);
	assert.equal(
		issue(runtime, "mission", { mission: "missile", targetCountryId: 2 }).ok,
		true,
	);
	assert.equal(country.equipment.missile, 4);
	assert.ok(roleModifiers(enemy, runtime).attack < enemyAttack);
	periods(runtime, 4);
	assert.equal(country.equipment.aircraft, 3);
	assert.equal(country.equipment.missile, 4);
	assert.equal(country.missions.length, 0);
	assert.equal(roleModifiers(own, runtime).attack, ownAttack);
}

// State survives JSON/structured-clone ownership transfers and stays bounded.
{
	const runtime = fixture({ maxUnits: 6 });
	for (const country of Object.values(runtime.campaign.countries))
		country.automation = true;
	periods(runtime, 120);
	assert.ok(runtime.units.length > 2);
	assert.ok(runtime.units.filter((unit) => unit.sideIndex === 0).length <= 6);
	assert.ok(runtime.units.filter((unit) => unit.sideIndex === 1).length <= 6);
	assert.ok(runtime.campaign.events.length <= 200);
	for (const country of Object.values(runtime.campaign.countries)) {
		assert.ok(country.queue.length <= CAMPAIGN_QUEUE_LIMIT);
		assert.ok(
			country.treasury >= 0 && country.reserve >= 0 && country.supplies >= 0,
		);
		assert.ok(
			Object.values(country.equipment).every(
				(amount) => Number.isSafeInteger(amount) && amount >= 0,
			),
		);
		const trainees = country.queue.reduce(
			(sum, order) => sum + (order.personnel || 0),
			0,
		);
		assert.equal(
			runtime.sideSoldiers[country.sideIndex],
			country.reserve + country.deployed + trainees,
		);
		assert.equal(
			runtime.sideRecruitableManpower[country.sideIndex],
			country.reserve,
		);
	}
	runtime.campaign = JSON.parse(JSON.stringify(runtime.campaign));
	assert.deepEqual(structuredClone(runtime.campaign), runtime.campaign);
	periods(runtime, 1);
	initializeCampaign(runtime, { enabled: false });
	assert.equal(
		issue(runtime, "train", { role: "infantry" }).reason,
		"disabled",
	);
	assert.deepEqual(roleModifiers(runtime.units[0], runtime), {
		attack: 1,
		defense: 1,
		speed: 1,
	});
}

// A solvent country starting with empty supplies and treasury must be able to
// finish civilian supply construction, then resume its blocked training order.
{
	const runtime = fixture({ maxUnits: 200 });
	for (let index = 1; index < 100; index++)
		runtime.units.push(
			createArmyFormation({
				id: 100 + index,
				lat: 0,
				lng: 1,
				sideIndex: 0,
				sovereignId: 1,
				health: 100,
				maxHealth: 100,
				personnel: 1000,
				personnelCapacity: 1000,
			}),
		);
	runtime.sideSoldiers[0] = 106_000;
	initializeCampaign(runtime);
	runtime.campaign.countries[2].automation = false;
	const country = runtime.campaign.countries[1];
	assert.equal(issue(runtime, "train", { role: "infantry" }).ok, true);
	const trainingId = country.queue[0].id;
	country.supplies = 0;
	country.treasury = 0;
	periods(runtime, 4);
	assert.ok(country.supplyRatio < 0.5);
	assert.equal(
		country.queue.find((order) => order.id === trainingId).remainingPeriods,
		3,
	);
	assert.ok(
		country.queue.some(
			(order) => order.type === "build" && order.building === "supply",
		),
	);
	periods(runtime, 8);
	assert.ok(country.cities[0].buildings.supply > 0);
	assert.equal(country.supplyRatio, 1);
	assert.ok(!country.queue.some((order) => order.id === trainingId));
	assert.ok(country.formations > 100);
	assert.ok(country.treasury >= 0);
}

console.log(
	"Campaign smoke passed: budget conservation, queues, ownership, roles, missions, mobilization and bounded AI.",
);
