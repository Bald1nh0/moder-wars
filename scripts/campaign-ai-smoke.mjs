import assert from "node:assert/strict";
import { createArmyFormation } from "../src/army-formation.js";
import {
	advanceCampaign,
	CAMPAIGN_PERIOD_TICKS,
	CAMPAIGN_QUEUE_LIMIT,
	commandCampaign,
	initializeCampaign,
	reconcileCampaignMembership,
} from "../src/campaign-core.js";
import { CONFIG } from "../src/config.js";

// Small deterministic country ledgers exercise the production AI without map
// rendering, random combat or a second copy of its decision logic.
function fixture({
	countries = 2,
	formations = 20,
	cap = 60,
	citiesPerCountry = 1,
} = {}) {
	const ids = Array.from({ length: countries }, (_, index) => index + 1);
	const runtime = {
		CONFIG: { ...CONFIG, MAX_UNITS_PER_SIDE: cap },
		MAX_SIDES: countries,
		_simTickCount: 0,
		gameState: "SIMULATING",
		sides: ids.map((id) => [{ id, troops: formations * 1000 }]),
		countryMetadata: ids.map((id) => ({ id, name: `Country ${id}`, pop: 1e6 })),
		units: ids.flatMap((id) =>
			Array.from({ length: formations }, (_, index) =>
				createArmyFormation({
					id: id * 1000 + index,
					lat: 0,
					lng: id,
					sideIndex: id - 1,
					sovereignId: id,
					health: 100,
					maxHealth: 100,
					personnel: 1000,
					personnelCapacity: 1000,
					deployTicks: 0,
				}),
			),
		),
		cities: ids.flatMap((id) =>
			Array.from({ length: citiesPerCountry }, (_, index) => ({
				id: index === 0 ? id : `${id}:${index}`,
				name: `City ${id}:${index}`,
				lat: 0,
				lng: id,
				sovereignId: id,
			})),
		),
		worldControlMap: new Uint16Array(ids),
		primaryOccupierMap: new Uint16Array(ids),
		hostilityMatrix: Uint8Array.from(
			{ length: countries * countries },
			(_, index) => Number(Math.floor(index / countries) !== index % countries),
		),
		getGridIndex(_lat, lng) {
			return lng - 1;
		},
		areSidesHostile(first, second) {
			return Boolean(this.hostilityMatrix[first * this.MAX_SIDES + second]);
		},
		sideRecruitableManpower: new Float64Array(countries).fill(100_000),
		sideSoldiers: new Float64Array(countries).fill(100_000 + formations * 1000),
		initialSideSoldiers: new Float64Array(countries).fill(
			100_000 + formations * 1000,
		),
	};
	initializeCampaign(runtime);
	for (const country of Object.values(runtime.campaign.countries)) {
		country.automation = country.id === 1;
		country.baseIncome = 2000;
		country.treasury = 10_000;
		country.supplies = 10_000;
		for (const key of Object.keys(country.equipment))
			country.equipment[key] = 100;
	}
	return runtime;
}

function periods(runtime, count, observe = () => {}) {
	for (let index = 0; index < count; index++) {
		runtime._simTickCount += CAMPAIGN_PERIOD_TICKS;
		assert.equal(advanceCampaign(runtime), true);
		observe(runtime);
	}
}

function issue(runtime, action, fields = {}, countryId = 1) {
	return commandCampaign(runtime, {
		type: "campaign",
		countryId,
		action,
		...fields,
	});
}

function roles(runtime, countryId, role) {
	for (const unit of runtime.units)
		if (unit.sovereignId === countryId) unit.campaignRole = role;
}

function events(runtime, countryId, type) {
	return runtime.campaign.events.filter(
		(event) => event.countryId === countryId && event.type === type,
	);
}

function noMissions(runtime, countryId = 1) {
	const country = runtime.campaign.countries[countryId];
	for (const key of ["aircraft", "reconDrone", "strikeDrone", "missile"])
		country.equipment[key] = 0;
}

function assertLedgers(runtime) {
	assert.ok(runtime.campaign.events.length <= 200);
	for (const country of Object.values(runtime.campaign.countries)) {
		for (const value of [
			country.treasury,
			country.reserve,
			country.supplies,
			country.civilianPool,
			...Object.values(country.equipment),
		])
			assert.ok(
				Number.isFinite(value) && value >= 0,
				`Invalid balance: ${value}`,
			);
		assert.ok(country.queue.length <= CAMPAIGN_QUEUE_LIMIT);
		const live = runtime.units.filter(
			(unit) =>
				unit.sovereignId === country.id &&
				unit.health > 0 &&
				unit.personnel > 0,
		);
		assert.ok(live.length <= runtime.CONFIG.MAX_UNITS_PER_SIDE);
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
		if (country.aiDecision) {
			assert.ok(country.aiDecision.period <= runtime.campaign.period);
			assert.ok(JSON.stringify(country.aiDecision).length < 1200);
		}
	}
}

function cloneRuntime(runtime, jsonCampaign = false) {
	const copied = structuredClone(
		Object.fromEntries(
			Object.entries(runtime).filter(
				([, value]) => typeof value !== "function",
			),
		),
	);
	copied.getGridIndex = runtime.getGridIndex;
	copied.areSidesHostile = runtime.areSidesHostile;
	if (jsonCampaign)
		copied.campaign = JSON.parse(JSON.stringify(copied.campaign));
	return copied;
}

const failures = [];
function check(name, run) {
	try {
		run();
		console.log(`Campaign AI: ${name} passed`);
	} catch (error) {
		failures.push(name);
		console.error(`Campaign AI: ${name} FAILED`, error);
	}
}

check(
	"financial shortage does not trigger physical supply construction",
	() => {
		const runtime = fixture();
		roles(runtime, 1, "armor");
		const country = runtime.campaign.countries[1];
		country.baseIncome = 0;
		country.treasury = 0;
		periods(runtime, 16);
		assert.ok(country.supplyRatio < 1);
		assert.ok(country.supplies > 9000);
		assert.equal(
			events(runtime, 1, "building_started").filter(
				(event) => event.building === "supply",
			).length,
			0,
		);
		assert.equal(events(runtime, 1, "training_started").length, 0);
		assert.equal(country.aiDecision.reason, "funds_shortage");
		assertLedgers(runtime);
	},
);

check("solvent physical shortages fund supply recovery", () => {
	const runtime = fixture({ formations: 100, cap: 120 });
	const country = runtime.campaign.countries[1];
	country.supplies = 0;
	periods(runtime, 20, assertLedgers);
	assert.ok(
		events(runtime, 1, "building_started").some(
			(event) => event.building === "supply",
		),
	);
	assert.ok(country.cities[0].buildings.supply > 0);
	assert.equal(country.supplyRatio, 1);
});

check("already queued upkeep prevents further unaffordable recruitment", () => {
	const runtime = fixture();
	roles(runtime, 1, "armor");
	noMissions(runtime);
	const country = runtime.campaign.countries[1];
	country.baseIncome = 105;
	country.treasury = 3000;
	assert.equal(
		issue(runtime, "train", { role: "armor", quantity: 5 }).ok,
		true,
	);
	const ordered = events(runtime, 1, "training_started").length;
	periods(runtime, 4, assertLedgers);
	assert.equal(events(runtime, 1, "training_started").length, ordered);
	assert.equal(
		country.queue.filter((order) => order.type === "train").length,
		5,
	);
});

check(
	"cash buffer is retained even when an order's immediate price is affordable",
	() => {
		const runtime = fixture();
		roles(runtime, 1, "armor");
		noMissions(runtime);
		const country = runtime.campaign.countries[1];
		country.baseIncome = 100;
		country.treasury = 150;
		periods(runtime, 12, assertLedgers);
		assert.equal(events(runtime, 1, "training_started").length, 0);
		assert.equal(country.treasury, 150);
		assert.ok(
			["saving_buffer", "funds_shortage"].includes(country.aiDecision.reason),
		);
	},
);

check("recruitment repairs an imbalanced army", () => {
	const runtime = fixture();
	roles(runtime, 1, "armor");
	noMissions(runtime);
	periods(runtime, 8);
	assert.ok(
		events(runtime, 1, "training_started").some(
			(event) => event.role === "infantry",
		),
	);
	assertLedgers(runtime);
});

check("air threats change recruitment toward air defense", () => {
	const runtime = fixture();
	noMissions(runtime);
	for (const unit of runtime.units)
		if (unit.sovereignId === 1 && unit.campaignRole === "airDefense")
			unit.campaignRole = "infantry";
	const enemy = runtime.campaign.countries[2];
	enemy.missions.push({
		mission: "aircraft",
		targetCountryId: 1,
		remainingPeriods: 50,
		effectiveness: 1,
	});
	periods(runtime, 12);
	assert.ok(
		events(runtime, 1, "training_started").some(
			(event) => event.role === "airDefense",
		),
	);
	assertLedgers(runtime);
});

check("new losses trigger replacement without unbounded growth", () => {
	const runtime = fixture();
	noMissions(runtime);
	periods(runtime, 1);
	for (const unit of runtime.units)
		if (unit.sovereignId === 1 && unit.campaignRole === "infantry") {
			unit.health = 0;
			unit.personnel = 0;
		}
	const firstEvent = runtime.campaign.nextEventId;
	const reasons = [];
	periods(runtime, 12, (state) => {
		assertLedgers(state);
		const decision = state.campaign.countries[1].aiDecision;
		if (decision?.period === state.campaign.period)
			reasons.push(decision.reason);
	});
	assert.ok(reasons.includes("replace_losses"));
	assert.ok(
		events(runtime, 1, "training_started").some(
			(event) => event.id >= firstEvent && event.role === "infantry",
		),
	);
});

check(
	"mission scoring selects a useful hostile target and excludes allies",
	() => {
		const runtime = fixture({ countries: 4 });
		for (const unit of runtime.units)
			if (unit.sovereignId === 2) {
				unit.health = 0;
				unit.personnel = 0;
			}
		runtime.hostilityMatrix[3] = 0;
		runtime.hostilityMatrix[12] = 0;
		roles(runtime, 3, "infantry");
		for (let index = 0; index < 40; index++)
			runtime.units.push(
				createArmyFormation({
					id: 50000 + index,
					lat: 0,
					lng: 4,
					sideIndex: 3,
					sovereignId: 4,
					health: 100,
					maxHealth: 100,
					personnel: 1000,
					personnelCapacity: 1000,
					campaignRole: "infantry",
				}),
			);
		periods(runtime, 24);
		const missions = events(runtime, 1, "mission");
		assert.ok(missions.length > 0);
		assert.ok(missions.every((event) => event.targetCountryId === 3));
		assertLedgers(runtime);
	},
);

check(
	"24-country scheduling allows every country to invest and launch missions",
	() => {
		const runtime = fixture({ countries: 24, formations: 12, cap: 12 });
		for (const country of Object.values(runtime.campaign.countries))
			country.automation = true;
		const investments = new Set();
		const missions = new Set();
		const decisions = new Map();
		periods(runtime, 60, (state) => {
			assertLedgers(state);
			for (const country of Object.values(state.campaign.countries)) {
				const decision = country.aiDecision;
				if (decision?.period === state.campaign.period) {
					const previous = decisions.get(country.id);
					if (previous !== undefined)
						assert.ok(decision.period - previous <= 8);
					decisions.set(country.id, decision.period);
				}
			}
			for (const event of state.campaign.events) {
				if (event.type === "building_started" && event.building === "economy")
					investments.add(event.countryId);
				if (event.type === "mission") missions.add(event.countryId);
			}
		});
		assert.equal(decisions.size, 24);
		assert.equal(investments.size, 24);
		assert.equal(missions.size, 24);
	},
);

check(
	"41-country decision batches stay bounded and do not starve the tail",
	() => {
		const runtime = fixture({ countries: 41, formations: 2, cap: 2 });
		for (const country of Object.values(runtime.campaign.countries))
			country.automation = true;
		const seen = new Set();
		periods(runtime, 30, (state) => {
			const decisions = Object.values(state.campaign.countries).filter(
				(country) => country.aiDecision?.period === state.campaign.period,
			);
			assert.ok(decisions.length <= 8);
			for (const country of decisions) seen.add(country.id);
		});
		assert.equal(seen.size, 41);
		assertLedgers(runtime);
	},
);

check(
	"automation off, missing cities and peace produce no autonomous orders",
	() => {
		const runtime = fixture();
		for (const country of Object.values(runtime.campaign.countries))
			country.automation = false;
		periods(runtime, 12);
		assert.equal(runtime.campaign.events.length, 0);
		const country = runtime.campaign.countries[1];
		country.automation = true;
		runtime.worldControlMap[0] = 2;
		runtime.primaryOccupierMap[0] = 2;
		periods(runtime, 12);
		assert.equal(events(runtime, 1, "training_started").length, 0);
		assert.equal(events(runtime, 1, "building_started").length, 0);
		assert.equal(country.aiDecision.reason, "no_city");
		const before = JSON.stringify(runtime.campaign);
		runtime.gameState = "IDLE";
		runtime._simTickCount += 100 * CAMPAIGN_PERIOD_TICKS;
		assert.equal(advanceCampaign(runtime), false);
		assert.equal(JSON.stringify(runtime.campaign), before);
	},
);

check("inactive countries stop acting after membership changes", () => {
	const runtime = fixture({ countries: 9 });
	for (const country of Object.values(runtime.campaign.countries))
		country.automation = true;
	periods(runtime, 8);
	runtime.sides[8] = [];
	reconcileCampaignMembership(runtime);
	const lastEvent = runtime.campaign.nextEventId;
	periods(runtime, 16);
	assert.equal(runtime.campaign.countries[9].active, false);
	assert.equal(
		runtime.campaign.events.filter(
			(event) => event.id >= lastEvent && event.countryId === 9,
		).length,
		0,
	);
});

check(
	"JSON and structured handoffs preserve deterministic AI continuation",
	() => {
		const runtime = fixture({ countries: 9 });
		for (const country of Object.values(runtime.campaign.countries))
			country.automation = true;
		periods(runtime, 17);
		const json = cloneRuntime(runtime, true);
		const structured = cloneRuntime(runtime);
		for (const state of [runtime, json, structured])
			periods(state, 80, assertLedgers);
		assert.deepEqual(json.campaign, runtime.campaign);
		assert.deepEqual(structured.campaign, runtime.campaign);
		assert.deepEqual(json.units, runtime.units);
		assert.deepEqual(structured.units, runtime.units);
		const legacy = fixture();
		for (const country of Object.values(legacy.campaign.countries)) {
			delete country.aiDecision;
			delete country.aiState;
		}
		periods(legacy, 12, assertLedgers);
		assert.ok(legacy.campaign.countries[1].aiDecision);
	},
);

check(
	"a recoverable deficit improves income without creating free resources",
	() => {
		const runtime = fixture({ cap: 30 });
		roles(runtime, 1, "armor");
		noMissions(runtime);
		const country = runtime.campaign.countries[1];
		country.baseIncome = 75;
		country.treasury = 500;
		periods(runtime, 180, assertLedgers);
		assert.ok(country.cities[0].buildings.economy > 0);
		assert.ok(country.income >= country.upkeep);
		assert.ok(country.treasury > 0);
		assert.equal(country.policy, "balanced");
	},
);

check(
	"equipment shortages produce stock before training the desired role",
	() => {
		const runtime = fixture();
		noMissions(runtime);
		const country = runtime.campaign.countries[1];
		country.equipment.airDefense = 0;
		for (const unit of runtime.units)
			if (unit.sovereignId === 1 && unit.campaignRole === "airDefense")
				unit.campaignRole = "infantry";
		runtime.campaign.countries[2].missions.push({
			mission: "aircraft",
			targetCountryId: 1,
			remainingPeriods: 50,
			effectiveness: 1,
		});
		periods(runtime, 24, assertLedgers);
		const produced = events(runtime, 1, "production_completed").find(
			(event) => event.equipment === "airDefense",
		);
		const trained = events(runtime, 1, "training_started").find(
			(event) => event.role === "airDefense",
		);
		assert.ok(produced && trained);
		assert.ok(produced.id < trained.id);
	},
);

check("target air defense changes which enemy offers a useful mission", () => {
	const preferred = [];
	for (const defended of [false, true]) {
		const runtime = fixture({ countries: 3, cap: 80 });
		roles(runtime, 2, "infantry");
		roles(runtime, 3, defended ? "airDefense" : "infantry");
		for (let index = 0; index < 20; index++)
			runtime.units.push(
				createArmyFormation({
					id: 60000 + index,
					lat: 0,
					lng: 3,
					sideIndex: 2,
					sovereignId: 3,
					health: 100,
					maxHealth: 100,
					personnel: 1000,
					personnelCapacity: 1000,
					campaignRole: defended ? "airDefense" : "infantry",
				}),
			);
		periods(runtime, 16, assertLedgers);
		preferred.push(events(runtime, 1, "mission")[0]?.targetCountryId);
	}
	assert.deepEqual(preferred, [3, 2]);
});

check(
	"offensive and defensive priorities select different useful mission types",
	() => {
		const preferred = [];
		for (const policy of ["offense", "defense"]) {
			const runtime = fixture();
			assert.equal(issue(runtime, "policy", { policy }).ok, true);
			periods(runtime, 16, assertLedgers);
			preferred.push(events(runtime, 1, "mission")[0]?.mission);
			assert.equal(runtime.campaign.countries[1].policy, policy);
		}
		assert.notEqual(preferred[0], "reconDrone");
		assert.equal(preferred[1], "reconDrone");
	},
);

check("countries without active hostiles do not order war expansion", () => {
	const runtime = fixture();
	runtime.hostilityMatrix.fill(0);
	periods(runtime, 24, assertLedgers);
	assert.equal(runtime.campaign.events.length, 0);
	assert.equal(runtime.campaign.countries[1].aiDecision.reason, "no_enemy");
});

// Decision fairness alone is insufficient: when a country's turn arrives less
// often than a mission cooldown, optional actions must still leave recruitment
// a turn. Multiple cities also expose endless economy/mission alternation.
for (const countries of [41, 48, 97]) {
	check(
		`${countries}-country optional actions leave every country recruitment turns`,
		() => {
			const runtime = fixture({
				countries,
				formations: 6,
				cap: 18,
				citiesPerCountry: countries < 97 ? 4 : 1,
			});
			for (const country of Object.values(runtime.campaign.countries)) {
				country.automation = true;
				if (countries === 97)
					for (const city of country.cities) city.buildings.economy = 3;
			}
			const trained = new Set();
			const operating = new Set();
			periods(runtime, 80, (state) => {
				assertLedgers(state);
				assert.ok(
					Object.values(state.campaign.countries).filter(
						(country) => country.aiDecision?.period === state.campaign.period,
					).length <= 8,
				);
				for (const event of state.campaign.events) {
					if (event.type === "training_started") trained.add(event.countryId);
					if (event.type === "mission") operating.add(event.countryId);
				}
			});
			assert.equal(
				trained.size,
				countries,
				"Optional missions/investments must not starve recruitment",
			);
			assert.equal(
				operating.size,
				countries,
				"Recruitment must also leave useful mission opportunities",
			);
		},
	);
}

if (failures.length) {
	console.error(
		`Campaign AI smoke: ${failures.length} failed: ${failures.join(", ")}`,
	);
	process.exitCode = 1;
} else
	console.log(
		"Campaign AI smoke passed: deterministic budgets, adaptation, scheduling, missions and bounded long-run recovery.",
	);
