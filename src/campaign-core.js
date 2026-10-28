import { createArmyFormation } from "./army-formation.js";
import { emitCampaignEvent } from "./campaign-events.js";
import {
	getCountryForceProfile,
	resolveCountryRelationship,
} from "./country-force-profiles.js";

// Credits, equipment packages and periods are fictional game-balance units.
// Dated source observations are attached separately and never imply readiness.
export const CAMPAIGN_PERIOD_TICKS = 120;
export const CAMPAIGN_QUEUE_LIMIT = 12;
export const CAMPAIGN_ROLES = Object.freeze({
	infantry: {
		cost: 120,
		duration: 3,
		personnel: 1000,
		equipment: {},
		upkeep: 2,
		attack: 1,
		defense: 1.05,
		speed: 1,
	},
	armor: {
		cost: 300,
		duration: 5,
		personnel: 1000,
		equipment: { armor: 10 },
		upkeep: 5,
		attack: 1.25,
		defense: 1.1,
		speed: 1.12,
	},
	artillery: {
		cost: 240,
		duration: 5,
		personnel: 1000,
		equipment: { artillery: 6 },
		upkeep: 4,
		attack: 1.18,
		defense: 0.9,
		speed: 0.8,
	},
	airDefense: {
		cost: 220,
		duration: 4,
		personnel: 1000,
		equipment: { airDefense: 4 },
		upkeep: 3,
		attack: 0.85,
		defense: 1.15,
		speed: 0.9,
	},
});
export const CAMPAIGN_EQUIPMENT = Object.freeze({
	armor: { cost: 18, duration: 3, batch: 1 },
	artillery: { cost: 22, duration: 3, batch: 1 },
	airDefense: { cost: 28, duration: 4, batch: 1 },
	aircraft: { cost: 180, duration: 7, batch: 1 },
	reconDrone: { cost: 40, duration: 2, batch: 1 },
	strikeDrone: { cost: 50, duration: 3, batch: 1 },
	missile: { cost: 90, duration: 4, batch: 1 },
});
export const CAMPAIGN_BUILDINGS = Object.freeze({
	economy: { cost: 300, duration: 4, maxLevel: 3, income: 35 },
	industry: { cost: 400, duration: 5, maxLevel: 3 },
	training: { cost: 260, duration: 4, maxLevel: 3 },
	supply: { cost: 200, duration: 3, maxLevel: 3 },
});
export const CAMPAIGN_MISSIONS = Object.freeze({
	aircraft: { cost: 90, duration: 3, supplies: 12, reusable: true },
	reconDrone: { cost: 25, duration: 4, supplies: 4, reusable: true },
	strikeDrone: { cost: 40, duration: 2, supplies: 8, reusable: false },
	missile: { cost: 60, duration: 2, supplies: 10, reusable: false },
});

const POLICIES = new Set(["balanced", "offense", "defense", "economy"]);
const NEUTRAL_MODIFIERS = Object.freeze({ attack: 1, defense: 1, speed: 1 });
const ok = () => ({ ok: true, reason: "ok" });
const fail = (reason) => ({ ok: false, reason });
const count = (value) =>
	Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
const living = (unit) =>
	unit.kind !== "transport" &&
	unit.health > 0 &&
	(unit.personnel === undefined || unit.personnel > 0);
const roleOf = (unit) =>
	Object.hasOwn(CAMPAIGN_ROLES, unit.campaignRole)
		? unit.campaignRole
		: "infantry";
const personnelOf = (runtime, unit) =>
	count(
		unit.personnel ??
			((unit.personnelCapacity ||
				runtime.CONFIG?.UNIT_TO_SOLDIER_RATIO ||
				1000) *
				unit.health) /
				(unit.maxHealth || 100),
	);
const countryUnits = (runtime, country) =>
	runtime.units.filter(
		(unit) => unit.sovereignId === country.id && living(unit),
	);
const ownedCities = (country) =>
	country.cities.filter((city) => city.controllerId === country.id);
const buildings = (country, name) =>
	ownedCities(country).reduce((sum, city) => sum + city.buildings[name], 0);
const activeCountries = (runtime) =>
	Object.values(runtime.campaign.countries).filter((country) =>
		runtime.sides[country.sideIndex]?.some(
			(entry) => (entry.id ?? entry) === country.id,
		),
	);
const isHostile = (runtime, first, second) =>
	runtime.areSidesHostile
		? runtime.areSidesHostile(first, second)
		: Boolean(
				runtime.hostilityMatrix?.[first * (runtime.MAX_SIDES || 8) + second],
			);
const membershipKey = (runtime) =>
	runtime.sides
		.map((members) => members.map((member) => member.id ?? member).join(","))
		.join("|");

function rebuildSideTotals(runtime) {
	runtime.sideRecruitableManpower.fill(0);
	runtime.sideSoldiers.fill(0);
	for (const country of activeCountries(runtime)) {
		const trainees = country.queue.reduce(
			(sum, order) => sum + (order.type === "train" ? order.personnel : 0),
			0,
		);
		runtime.sideRecruitableManpower[country.sideIndex] += country.reserve;
		runtime.sideSoldiers[country.sideIndex] +=
			country.reserve + country.deployed + trainees;
	}
	for (let side = 0; side < runtime.sideSoldiers.length; side++) {
		if (runtime.initialSideSoldiers)
			runtime.initialSideSoldiers[side] = Math.max(
				runtime.initialSideSoldiers[side],
				runtime.sideSoldiers[side],
			);
	}
}

/** Diplomacy transfers an existing ledger; it never recreates its resources. */
export function reconcileCampaignMembership(runtime) {
	const campaign = runtime.campaign;
	if (!campaign?.enabled || campaign.membershipKey === membershipKey(runtime))
		return false;
	const newSides = runtime.sides.map(() => []);
	const newIds = new Set();
	const reserveForNew = new Float64Array(runtime.sideRecruitableManpower);
	for (const country of Object.values(campaign.countries))
		country.active = false;
	for (const [sideIndex, members] of runtime.sides.entries())
		for (const member of members) {
			const id = member.id ?? member;
			const country = campaign.countries[id];
			if (country) {
				country.sideIndex = sideIndex;
				country.active = true;
				reserveForNew[sideIndex] = Math.max(
					0,
					reserveForNew[sideIndex] - country.reserve,
				);
			} else {
				newSides[sideIndex].push(member);
				newIds.add(id);
			}
		}
	if (newIds.size) {
		// Initialize only first-time entrants from the residual reserve added by
		// the existing diplomacy lifecycle. Existing campaign balances stay intact.
		const profiles = Object.fromEntries(
			runtime.countryMetadata
				.filter((country) => country && newIds.has(country.id))
				.map((country) => [
					country.id,
					getCountryForceProfile(country, campaign.scenarioDate),
				]),
		);
		const newcomers = initializeCampaign(
			{
				CONFIG: runtime.CONFIG,
				sides: newSides,
				countryMetadata: runtime.countryMetadata,
				units: runtime.units.filter((unit) => newIds.has(unit.sovereignId)),
				cities: runtime.cities,
				activeTheaterCities: runtime.activeTheaterCities,
				worldControlMap: runtime.worldControlMap,
				primaryOccupierMap: runtime.primaryOccupierMap,
				getGridIndex: runtime.getGridIndex,
				gridWidth: runtime.gridWidth,
				sideRecruitableManpower: reserveForNew,
				_simTickCount: runtime._simTickCount,
			},
			{ profiles },
		);
		Object.assign(campaign.countries, newcomers.countries);
	}
	for (const unit of runtime.units) {
		const country = campaign.countries[unit.sovereignId];
		if (country?.active) unit.sideIndex = country.sideIndex;
	}
	campaign.membershipKey = membershipKey(runtime);
	refreshCities(runtime);
	refreshForces(runtime);
	rebuildSideTotals(runtime);
	refreshEffects(runtime);
	refreshRelationships(runtime);
	return true;
}

function refreshRelationships(runtime) {
	const metadataById = new Map(
		runtime.countryMetadata
			.filter(Boolean)
			.map((country) => [country.id, country]),
	);
	for (const country of activeCountries(runtime))
		country.relationship = resolveCountryRelationship(
			metadataById.get(country.id),
			runtime.countryMetadata,
			runtime.campaign.scenarioDate,
		);
}

function cityController(runtime, city) {
	const index =
		runtime.getGridIndex?.(city.lat, city.lng) ??
		(runtime.gridWidth
			? Math.floor((city.lat + 90) / runtime.CONFIG.GRID_RES) *
					runtime.gridWidth +
				Math.floor((city.lng + 180) / runtime.CONFIG.GRID_RES)
			: -1);
	if (index < 0 || index >= (runtime.worldControlMap?.length || 0))
		return city.controllerId;
	return (
		runtime.primaryOccupierMap?.[index] ||
		runtime.worldControlMap[index] ||
		city.controllerId
	);
}

function refreshCities(runtime) {
	const countries = runtime.campaign.countries;
	// Move existing city records, preserving buildings and their stable identity.
	const cities = Object.values(countries).flatMap((country) => country.cities);
	for (const country of Object.values(countries)) country.cities = [];
	for (const city of cities) {
		city.controllerId = cityController(runtime, city);
		const holder =
			countries[city.controllerId] || countries[city.originalCountryId];
		if (holder) holder.cities.push(city);
	}
}

function refreshForces(runtime) {
	for (const country of Object.values(runtime.campaign.countries)) {
		country.deployed = 0;
		country.formations = 0;
		country.roleCounts = { infantry: 0, armor: 0, artillery: 0, airDefense: 0 };
		country.assignedEquipment = Object.fromEntries(
			Object.keys(CAMPAIGN_EQUIPMENT).map((key) => [key, 0]),
		);
	}
	for (const unit of runtime.units) {
		const country = runtime.campaign.countries[unit.sovereignId];
		if (!country || !living(unit)) continue;
		country.deployed += personnelOf(runtime, unit);
		country.formations++;
		country.roleCounts[roleOf(unit)]++;
		if (!unit.campaignRole) unit.campaignRole = "infantry";
		for (const [key, quantity] of Object.entries(
			unit.campaignEquipment || {},
		)) {
			country.assignedEquipment[key] += quantity;
		}
	}
}

function refreshEffects(runtime) {
	const countries = Object.values(runtime.campaign.countries);
	for (const country of countries) {
		const supply = 0.65 + 0.35 * country.supplyRatio;
		country.modifiers = {
			attack:
				supply *
				(country.policy === "offense"
					? 1.12
					: country.policy === "economy"
						? 0.9
						: 1),
			defense: supply * (country.policy === "defense" ? 1.12 : 1),
			speed: supply,
		};
	}
	for (const country of countries)
		for (const mission of country.missions) {
			const target = runtime.campaign.countries[mission.targetCountryId];
			if (
				country.active === false ||
				!target ||
				target.active === false ||
				!isHostile(runtime, country.sideIndex, target.sideIndex)
			)
				continue;
			const strength = mission.effectiveness;
			if (mission.mission === "aircraft")
				country.modifiers.attack *= 1 + 0.12 * strength;
			if (mission.mission === "reconDrone") {
				country.modifiers.defense *= 1 + 0.1 * strength;
				country.modifiers.speed *= 1.05;
			}
			if (mission.mission === "strikeDrone")
				target.modifiers.defense = Math.max(
					0.5,
					target.modifiers.defense * (1 - 0.08 * strength),
				);
			if (mission.mission === "missile") {
				target.modifiers.attack = Math.max(
					0.5,
					target.modifiers.attack * (1 - 0.1 * strength),
				);
				target.modifiers.speed = Math.max(
					0.5,
					target.modifiers.speed * (1 - 0.08 * strength),
				);
			}
		}
	for (const country of countries) {
		country.roleModifiers = Object.fromEntries(
			Object.entries(CAMPAIGN_ROLES).map(([key, role]) => [
				key,
				{
					attack: role.attack * country.modifiers.attack,
					defense: role.defense * country.modifiers.defense,
					speed: role.speed * country.modifiers.speed,
				},
			]),
		);
	}
}

function refreshEconomy(country) {
	const controlledCities = ownedCities(country).length;
	const controlRatio = Math.min(
		1.5,
		controlledCities / Math.max(1, country.initialCityCount),
	);
	const civilFactor = [1, 0.9, 0.72][country.mobilization];
	country.income = Math.floor(
		(country.baseIncome * controlRatio + buildings(country, "economy") * 35) *
			civilFactor *
			(country.policy === "economy" ? 1.2 : 1),
	);
	country.upkeep =
		Object.entries(country.roleCounts).reduce(
			(sum, [role, amount]) => sum + amount * CAMPAIGN_ROLES[role].upkeep,
			0,
		) +
		country.mobilization * 10;
}

/** Reset on a new war; owner handoffs must transfer the existing field instead. */
export function initializeCampaign(
	runtime,
	{ profiles = [], enabled = true } = {},
) {
	const campaign = {
		version: 1,
		enabled: Boolean(enabled),
		period: 0,
		periodTicks: CAMPAIGN_PERIOD_TICKS,
		lastTick: count(runtime._simTickCount),
		nextOrderId: 1,
		nextFormationId: 1,
		countries: {},
		events: [],
		nextEventId: 1,
		membershipKey: membershipKey(runtime),
		aiCursor: 0,
	};
	runtime.campaign = campaign;
	if (!enabled) return campaign;
	for (const [sideIndex, members] of runtime.sides.entries()) {
		const identities = members.map((member) =>
			typeof member === "object" ? member : { id: member },
		);
		const totalWeight = identities.reduce(
			(sum, member) => sum + Math.max(1, count(member.troops)),
			0,
		);
		let remainingReserve = count(runtime.sideRecruitableManpower?.[sideIndex]);
		identities.forEach((member, index) => {
			const metadata =
				runtime.countryMetadata.find((entry) => entry?.id === member.id) ||
				member;
			const reserve =
				index === identities.length - 1
					? remainingReserve
					: Math.floor(
							(count(runtime.sideRecruitableManpower?.[sideIndex]) *
								Math.max(1, count(member.troops))) /
								totalWeight,
						);
			remainingReserve -= reserve;
			const profile = Array.isArray(profiles)
				? profiles.find(
						(entry) =>
							entry?.countryId === member.id || entry?.id === member.id,
					)
				: profiles[member.id];
			campaign.countries[member.id] = {
				id: member.id,
				active: true,
				sideIndex,
				treasury: 0,
				reserve,
				civilianPool: Math.max(
					1000,
					Math.min(
						2_000_000,
						Math.floor(count(metadata.pop) * 0.02) || reserve,
					),
				),
				mobilization: 0,
				policy: "balanced",
				automation: true,
				equipment: {
					armor: 30,
					artillery: 18,
					airDefense: 12,
					aircraft: 3,
					reconDrone: 5,
					strikeDrone: 5,
					missile: 3,
				},
				cities: [],
				queue: [],
				missions: [],
				income: 0,
				upkeep: 0,
				deployed: 0,
				formations: 0,
				roleCounts: {},
				assignedEquipment: {},
				supplies: 0,
				supplyRatio: 1,
				baseIncome: 0,
				initialCityCount: 0,
				profile: profile || null,
				balanceSource: "fictional-game-assumptions",
			};
		});
	}
	const sourceCities = runtime.cities?.length
		? runtime.cities
		: runtime.activeTheaterCities || [];
	sourceCities.forEach((city, index) => {
		const originalCountryId =
			city.sovereignId || city.countryId || city.ownerId;
		const original = campaign.countries[originalCountryId];
		if (!original) return;
		const record = {
			id: city.id ?? `city-${index}`,
			name: city.name || "",
			lat: city.lat,
			lng: city.lng,
			originalCountryId,
			controllerId: originalCountryId,
			buildings: { economy: 0, industry: 0, training: 0, supply: 0 },
		};
		record.controllerId = cityController(runtime, record);
		(campaign.countries[record.controllerId] || original).cities.push(record);
	});
	const roles = [
		"infantry",
		"infantry",
		"infantry",
		"armor",
		"infantry",
		"artillery",
		"infantry",
		"armor",
		"infantry",
		"airDefense",
	];
	const countryIndices = {};
	for (const unit of runtime.units) {
		if (!campaign.countries[unit.sovereignId] || !living(unit)) continue;
		const ordinal = countryIndices[unit.sovereignId] || 0;
		countryIndices[unit.sovereignId] = ordinal + 1;
		unit.campaignRole = roles[ordinal % roles.length];
		unit.campaignEquipment = { ...CAMPAIGN_ROLES[unit.campaignRole].equipment };
	}
	refreshForces(runtime);
	for (const country of Object.values(campaign.countries)) {
		country.initialCityCount = ownedCities(country).length;
		const scale = Math.min(
			8,
			1 +
				Math.floor(
					Math.sqrt(country.deployed / 20_000 + country.initialCityCount / 12),
				),
		);
		for (const key of Object.keys(country.equipment))
			country.equipment[key] *= scale;
		const assumptions = country.profile?.gameAssumptions;
		if (assumptions && typeof assumptions === "object") {
			for (const key of Object.keys(country.equipment)) {
				const override = assumptions.equipment?.[key];
				if (Number.isFinite(override) && override >= 0)
					country.equipment[key] = Math.min(10_000, Math.floor(override));
			}
			if (
				Number.isFinite(assumptions.civilianPool) &&
				assumptions.civilianPool >= 0
			)
				country.civilianPool = Math.min(
					2_000_000,
					Math.floor(assumptions.civilianPool),
				);
		}
		country.baseIncome =
			80 + country.formations * 4 + country.initialCityCount * 8;
		if (Number.isFinite(assumptions?.baseIncome) && assumptions.baseIncome >= 0)
			country.baseIncome = Math.min(
				1_000_000,
				Math.floor(assumptions.baseIncome),
			);
		country.supplies = 200 + country.formations * 10;
		refreshEconomy(country);
		country.treasury = 1200 + country.income * 8;
		if (Number.isFinite(assumptions?.treasury) && assumptions.treasury >= 0)
			country.treasury = Math.min(
				1_000_000_000,
				Math.floor(assumptions.treasury),
			);
	}
	refreshEffects(runtime);
	return campaign;
}

function enqueue(runtime, country, entry) {
	const order = { id: runtime.campaign.nextOrderId++, ...entry };
	country.queue.push(order);
	return order;
}

function formationSlots(runtime, country) {
	const alive = runtime.units.reduce(
		(sum, unit) =>
			sum + Number(unit.sideIndex === country.sideIndex && living(unit)),
		0,
	);
	const queued = Object.values(runtime.campaign.countries)
		.filter((candidate) => candidate.sideIndex === country.sideIndex)
		.reduce(
			(sum, candidate) =>
				sum + candidate.queue.filter((entry) => entry.type === "train").length,
			0,
		);
	return Math.max(
		0,
		(runtime.CONFIG?.MAX_UNITS_PER_SIDE || 800) - alive - queued,
	);
}

function train(runtime, country, command) {
	const definition = CAMPAIGN_ROLES[command.role];
	if (!definition || !Object.hasOwn(CAMPAIGN_ROLES, command.role))
		return fail("invalid_role");
	const quantity = command.quantity ?? 1;
	if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10)
		return fail("invalid_quantity");
	if (country.queue.length + quantity > CAMPAIGN_QUEUE_LIMIT)
		return fail("queue_full");
	if (!ownedCities(country).length) return fail("no_city");
	if (formationSlots(runtime, country) < quantity) return fail("formation_cap");
	if (country.treasury < definition.cost * quantity) return fail("funds");
	if (
		Math.min(
			country.reserve,
			runtime.sideRecruitableManpower[country.sideIndex],
		) <
		definition.personnel * quantity
	)
		return fail("manpower");
	for (const [key, amount] of Object.entries(definition.equipment))
		if (country.equipment[key] < amount * quantity) return fail("equipment");
	country.treasury -= definition.cost * quantity;
	country.reserve -= definition.personnel * quantity;
	runtime.sideRecruitableManpower[country.sideIndex] -=
		definition.personnel * quantity;
	for (const [key, amount] of Object.entries(definition.equipment))
		country.equipment[key] -= amount * quantity;
	for (let index = 0; index < quantity; index++)
		enqueue(runtime, country, {
			type: "train",
			role: command.role,
			quantity: 1,
			personnel: definition.personnel,
			cost: definition.cost,
			remainingPeriods: definition.duration,
		});
	emitCampaignEvent(runtime, "training_started", {
		countryId: country.id,
		role: command.role,
		quantity,
	});
	return ok();
}

function build(runtime, country, command) {
	const definition = CAMPAIGN_BUILDINGS[command.building];
	if (!definition || !Object.hasOwn(CAMPAIGN_BUILDINGS, command.building))
		return fail("invalid_building");
	const city = country.cities.find(
		(entry) => String(entry.id) === String(command.cityId),
	);
	if (!city || city.controllerId !== country.id) return fail("no_city");
	if (country.queue.length >= CAMPAIGN_QUEUE_LIMIT) return fail("queue_full");
	const queuedLevels = country.queue.filter(
		(entry) =>
			entry.type === "build" &&
			entry.cityId === city.id &&
			entry.building === command.building,
	).length;
	if (city.buildings[command.building] + queuedLevels >= definition.maxLevel)
		return fail("max_level");
	const cost =
		definition.cost * (1 + city.buildings[command.building] + queuedLevels);
	if (country.treasury < cost) return fail("funds");
	country.treasury -= cost;
	enqueue(runtime, country, {
		type: "build",
		cityId: city.id,
		building: command.building,
		quantity: 1,
		cost,
		remainingPeriods: definition.duration,
	});
	emitCampaignEvent(runtime, "building_started", {
		countryId: country.id,
		cityId: city.id,
		building: command.building,
	});
	return ok();
}

function production(runtime, country, command) {
	const definition = CAMPAIGN_EQUIPMENT[command.equipment];
	if (!definition || !Object.hasOwn(CAMPAIGN_EQUIPMENT, command.equipment))
		return fail("invalid_equipment");
	const quantity = command.quantity ?? 1;
	if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10)
		return fail("invalid_quantity");
	if (!ownedCities(country).length) return fail("no_city");
	if (country.queue.length >= CAMPAIGN_QUEUE_LIMIT) return fail("queue_full");
	if (country.treasury < definition.cost * quantity) return fail("funds");
	country.treasury -= definition.cost * quantity;
	enqueue(runtime, country, {
		type: "production",
		equipment: command.equipment,
		quantity,
		cost: definition.cost * quantity,
		remainingPeriods: definition.duration + Math.floor((quantity - 1) / 3),
	});
	emitCampaignEvent(runtime, "production_started", {
		countryId: country.id,
		equipment: command.equipment,
		quantity,
	});
	return ok();
}

function mission(runtime, country, command) {
	const definition = CAMPAIGN_MISSIONS[command.mission];
	if (!definition || !Object.hasOwn(CAMPAIGN_MISSIONS, command.mission))
		return fail("invalid_mission");
	const target = runtime.campaign.countries[command.targetCountryId];
	if (
		!target ||
		!activeCountries(runtime).includes(target) ||
		!isHostile(runtime, country.sideIndex, target.sideIndex)
	)
		return fail("invalid_target");
	if (runtime.bombsDisabled && command.mission !== "reconDrone")
		return fail("bombs_disabled");
	if (country.missions.some((entry) => entry.mission === command.mission))
		return fail("mission_busy");
	if (country.equipment[command.mission] < 1) return fail("equipment");
	if (country.treasury < definition.cost) return fail("funds");
	if (country.supplies < definition.supplies) return fail("supplies");
	country.equipment[command.mission]--;
	country.treasury -= definition.cost;
	country.supplies -= definition.supplies;
	const defense = Math.min(0.75, (target.roleCounts.airDefense || 0) * 0.08);
	country.missions.push({
		mission: command.mission,
		targetCountryId: target.id,
		remainingPeriods: definition.duration,
		effectiveness: 1 - defense,
	});
	// One decorative trace represents the aggregate mission; it must not apply
	// the legacy bomb's damage on top of the country-level mission effect.
	if (
		(command.mission === "strikeDrone" || command.mission === "missile") &&
		typeof runtime.launchBomb === "function" &&
		(runtime.bombs?.length || 0) < 32
	) {
		const origin = ownedCities(country)[0] || countryUnits(runtime, country)[0];
		const destination =
			countryUnits(runtime, target)[0] || ownedCities(target)[0];
		if (origin && destination) {
			const previousCount = runtime.bombs?.length || 0;
			runtime.launchBomb(
				origin.lat,
				origin.lng,
				destination.lat,
				destination.lng,
				country.sideIndex,
			);
			if (runtime.bombs?.length === previousCount + 1)
				runtime.bombs.at(-1).campaignDecorative = true;
		}
	}
	refreshEffects(runtime);
	emitCampaignEvent(runtime, "mission", {
		countryId: country.id,
		targetCountryId: target.id,
		mission: command.mission,
	});
	return ok();
}

function demobilize(runtime, country, command) {
	const unit = countryUnits(runtime, country).find((entry) =>
		command.unitId !== undefined
			? entry.id === command.unitId
			: roleOf(entry) === (command.role || "infantry"),
	);
	if (!unit) return fail("no_formation");
	const personnel = personnelOf(runtime, unit);
	country.reserve += personnel;
	runtime.sideRecruitableManpower[country.sideIndex] += personnel;
	const surviving = Math.min(
		1,
		personnel / Math.max(1, unit.personnelCapacity || personnel),
	);
	for (const [key, quantity] of Object.entries(unit.campaignEquipment || {}))
		country.equipment[key] += Math.floor(quantity * surviving * 0.8);
	const role = roleOf(unit);
	runtime.units.splice(runtime.units.indexOf(unit), 1);
	refreshForces(runtime);
	emitCampaignEvent(runtime, "demobilized", {
		countryId: country.id,
		role,
		quantity: personnel,
	});
	return ok();
}

function cancelOrder(runtime, country, command) {
	const order = country.queue.find((entry) => entry.id === command.orderId);
	if (!order) return fail("invalid_order");
	const refund = Math.floor(order.cost * 0.75);
	country.treasury += refund;
	if (order.type === "train") {
		country.reserve += order.personnel;
		runtime.sideRecruitableManpower[country.sideIndex] += order.personnel;
		for (const [key, quantity] of Object.entries(
			CAMPAIGN_ROLES[order.role].equipment,
		))
			country.equipment[key] += quantity;
	}
	country.queue.splice(country.queue.indexOf(order), 1);
	emitCampaignEvent(runtime, "order_cancelled", {
		countryId: country.id,
		quantity: 1,
		cost: refund,
	});
	return ok();
}

/** Validate every request on the simulation owner, including AI requests. */
export function commandCampaign(runtime, command) {
	if (!runtime.campaign?.enabled) return fail("disabled");
	if (!command || command.type !== "campaign") return fail("invalid_command");
	if (
		runtime.gameState &&
		(runtime.gameState === "WAR_OVER" ||
			runtime.gameState === "MAIN_MENU" ||
			(runtime.gameState !== "SIMULATING" && !runtime.godModeActive))
	)
		return fail("inactive_game");
	reconcileCampaignMembership(runtime);
	const country = runtime.campaign.countries[command.countryId];
	if (!country || !activeCountries(runtime).includes(country))
		return fail("invalid_country");
	refreshCities(runtime);
	switch (command.action) {
		case "train":
			return train(runtime, country, command);
		case "build":
			return build(runtime, country, command);
		case "production":
			return production(runtime, country, command);
		case "mission":
			return mission(runtime, country, command);
		case "demobilize":
			return demobilize(runtime, country, command);
		case "cancel":
			return cancelOrder(runtime, country, command);
		case "mobilize": {
			if (
				!Number.isInteger(command.level) ||
				command.level < 0 ||
				command.level > 2
			)
				return fail("invalid_level");
			if (country.mobilization === command.level) return ok();
			if (country.treasury < 50) return fail("funds");
			country.treasury -= 50;
			country.mobilization = command.level;
			refreshEconomy(country);
			emitCampaignEvent(runtime, "mobilization", {
				countryId: country.id,
				level: command.level,
			});
			return ok();
		}
		case "policy": {
			if (command.policy !== undefined && !POLICIES.has(command.policy))
				return fail("invalid_policy");
			if (
				command.automation !== undefined &&
				typeof command.automation !== "boolean"
			)
				return fail("invalid_command");
			if (command.policy !== undefined) country.policy = command.policy;
			if (command.automation !== undefined)
				country.automation = command.automation;
			refreshEconomy(country);
			refreshEffects(runtime);
			emitCampaignEvent(runtime, "policy", {
				countryId: country.id,
				policy: country.policy,
			});
			return ok();
		}
		default:
			return fail("invalid_command");
	}
}

function deploy(runtime, country, order) {
	const cities = ownedCities(country);
	if (!cities.length) return false;
	const sideCount = runtime.units.reduce(
		(sum, unit) =>
			sum + Number(unit.sideIndex === country.sideIndex && living(unit)),
		0,
	);
	if (sideCount >= (runtime.CONFIG.MAX_UNITS_PER_SIDE || 800)) return false;
	const city = cities[order.id % cities.length];
	// A fractional suffix keeps legacy spatial group hashes distributed. Existing
	// formations commonly use random fractions as their numeric identity.
	let id;
	do {
		const sequence = runtime.campaign.nextFormationId++;
		id = 1_000_000 + sequence + ((sequence * 0.61803398875) % 1);
	} while (runtime.units.some((unit) => unit.id === id));
	const unit = createArmyFormation(
		{
			id,
			lat: city.lat,
			lng: city.lng,
			sideIndex: country.sideIndex,
			sovereignId: country.id,
			deployTicks: 30,
			health: runtime.CONFIG.UNIT_HEALTH,
			maxHealth: runtime.CONFIG.UNIT_HEALTH,
			personnel: order.personnel,
			personnelCapacity: order.personnel,
			nominalPersonnel: 1000,
			strengthMultiplier: order.personnel / 1000,
			campaignRole: order.role,
			campaignEquipment: { ...CAMPAIGN_ROLES[order.role].equipment },
		},
		runtime.CONFIG,
	);
	runtime.units.push(unit);
	emitCampaignEvent(runtime, "training_completed", {
		countryId: country.id,
		role: order.role,
		quantity: order.personnel,
	});
	return true;
}

function processQueue(runtime, country) {
	const liveCities = ownedCities(country);
	if (!liveCities.length) return;
	const active = { train: 0, production: 0, build: 0 };
	const slots = {
		train: 1 + Math.min(3, buildings(country, "training")),
		production: 1 + Math.min(3, buildings(country, "industry")),
		build: 1,
	};
	const completed = new Set();
	for (const order of country.queue) {
		// Civilian construction must remain available to restore depleted supply.
		if (order.type !== "build" && country.supplyRatio < 0.5) continue;
		if (active[order.type] >= slots[order.type]) continue;
		const city =
			order.type === "build"
				? liveCities.find((entry) => entry.id === order.cityId)
				: null;
		if (order.type === "build" && !city) continue;
		active[order.type]++;
		order.remainingPeriods = Math.max(0, order.remainingPeriods - 1);
		if (order.remainingPeriods > 0) continue;
		if (order.type === "train") {
			if (!deploy(runtime, country, order)) continue;
		} else if (order.type === "production") {
			country.equipment[order.equipment] += order.quantity;
			emitCampaignEvent(runtime, "production_completed", {
				countryId: country.id,
				equipment: order.equipment,
				quantity: order.quantity,
			});
		} else {
			city.buildings[order.building]++;
			emitCampaignEvent(runtime, "building_completed", {
				countryId: country.id,
				cityId: city.id,
				building: order.building,
			});
		}
		completed.add(order.id);
	}
	country.queue = country.queue.filter((order) => !completed.has(order.id));
}

function automate(runtime, country) {
	if (!country.automation) return;
	const issue = (command) =>
		commandCampaign(runtime, {
			type: "campaign",
			countryId: country.id,
			...command,
		});
	const period = runtime.campaign.period;
	const supplyDemand = Math.max(1, Math.ceil(country.formations / 5));
	if (country.supplies < supplyDemand * 4 || country.supplyRatio < 0.8) {
		const supplyCity = ownedCities(country).find(
			(entry) => entry.buildings.supply < CAMPAIGN_BUILDINGS.supply.maxLevel,
		);
		if (
			supplyCity &&
			!country.queue.some(
				(order) => order.type === "build" && order.building === "supply",
			)
		) {
			if (
				issue({ action: "build", cityId: supplyCity.id, building: "supply" }).ok
			)
				return;
		}
	}
	if (country.queue.length > 3) return;
	const city = ownedCities(country).find(
		(entry) => entry.buildings.economy < 2,
	);
	if (
		city &&
		(period % 12 === 0 || country.policy === "economy") &&
		country.treasury > 600
	) {
		if (issue({ action: "build", cityId: city.id, building: "economy" }).ok)
			return;
	}
	if (
		country.reserve < 2000 &&
		country.mobilization === 0 &&
		country.civilianPool > 0
	) {
		issue({ action: "mobilize", level: 1 });
		return;
	}
	const target = activeCountries(runtime).find((entry) =>
		isHostile(runtime, country.sideIndex, entry.sideIndex),
	);
	if (target && period % 12 === 4) {
		const missionType =
			country.policy === "defense" ? "reconDrone" : "aircraft";
		if (
			issue({
				action: "mission",
				mission: missionType,
				targetCountryId: target.id,
			}).ok
		)
			return;
	}
	const roles =
		country.policy === "defense"
			? ["infantry", "airDefense", "artillery"]
			: ["infantry", "armor", "artillery", "infantry"];
	const role = roles[(Math.floor(period / 4) + country.id) % roles.length];
	const shortage = Object.entries(CAMPAIGN_ROLES[role].equipment).find(
		([key, quantity]) => country.equipment[key] < quantity,
	);
	if (shortage && country.reserve >= 1000) {
		issue({
			action: "production",
			equipment: shortage[0],
			quantity: Math.min(10, shortage[1]),
		});
	} else if (country.policy !== "economy" || period % 12 === 0) {
		issue({ action: "train", role });
	}
}

/** Coarse bounded updates: never run economy or AI for each rendering frame. */
export function advanceCampaign(runtime) {
	const campaign = runtime.campaign;
	if (!campaign?.enabled) return false;
	if (runtime.gameState && runtime.gameState !== "SIMULATING") return false;
	const tick = count(runtime._simTickCount);
	if (tick - campaign.lastTick < CAMPAIGN_PERIOD_TICKS) return false;
	campaign.lastTick = tick;
	campaign.period++;
	reconcileCampaignMembership(runtime);
	refreshCities(runtime);
	refreshForces(runtime);
	const countries = activeCountries(runtime);
	for (const country of countries) {
		refreshEconomy(country);
		const before = country.treasury;
		country.treasury = Math.max(
			0,
			Math.min(
				1_000_000_000,
				country.treasury + country.income - country.upkeep,
			),
		);
		const demand = Math.max(1, Math.ceil(country.formations / 5));
		country.supplies = Math.min(
			100_000,
			country.supplies +
				ownedCities(country).length * 2 +
				buildings(country, "supply") * 20,
		);
		country.supplyRatio = Math.min(
			1,
			country.supplies / demand,
			(before + country.income) / Math.max(1, country.upkeep),
		);
		country.supplies = Math.max(0, country.supplies - demand);
		if (country.supplyRatio < 1 && campaign.period % 6 === 0)
			emitCampaignEvent(runtime, "shortage", {
				countryId: country.id,
				reason: country.treasury === 0 ? "funds" : "supplies",
			});
		if (country.mobilization > 0 && ownedCities(country).length) {
			const recruits = Math.min(
				country.civilianPool,
				country.mobilization *
					(100 + Math.min(20, buildings(country, "training")) * 25),
			);
			country.civilianPool -= recruits;
			country.reserve += recruits;
			runtime.sideRecruitableManpower[country.sideIndex] += recruits;
			runtime.sideSoldiers[country.sideIndex] += recruits;
			if (runtime.initialSideSoldiers)
				runtime.initialSideSoldiers[country.sideIndex] += recruits;
		}
		for (const mission of country.missions) {
			mission.remainingPeriods--;
			if (
				mission.remainingPeriods <= 0 &&
				CAMPAIGN_MISSIONS[mission.mission].reusable
			)
				country.equipment[mission.mission]++;
		}
		country.missions = country.missions.filter(
			(mission) => mission.remainingPeriods > 0,
		);
		processQueue(runtime, country);
	}
	if (campaign.period % 4 === 0 && countries.length) {
		// Round-robin country budgets bound AI bursts even in global free-for-all.
		const budget = Math.min(8, countries.length);
		for (let index = 0; index < budget; index++)
			automate(
				runtime,
				countries[(campaign.aiCursor + index) % countries.length],
			);
		campaign.aiCursor = (campaign.aiCursor + budget) % countries.length;
	}
	refreshForces(runtime);
	rebuildSideTotals(runtime);
	refreshEffects(runtime);
	refreshRelationships(runtime);
	return true;
}

/** Abstract combined-arms effects, independent of real weapon performance. */
export function roleModifiers(unit, runtime) {
	const country =
		runtime.campaign?.enabled && runtime.campaign.countries[unit.sovereignId];
	return country?.roleModifiers?.[roleOf(unit)] || NEUTRAL_MODIFIERS;
}
