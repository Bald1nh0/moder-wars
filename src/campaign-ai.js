// Deterministic campaign planning over country aggregates, never map cells.
// All resulting orders still pass through the same owner commands as player orders.
const DECISION_INTERVAL = 4;
const ACTION_INTERVAL = 12;
const HORIZON = 8;
const RESERVE_PERIODS = 4;
const ROLES = ["infantry", "armor", "artillery", "airDefense"];
const ownCities = (country) =>
	country.cities.filter((city) => city.controllerId === country.id);
const levels = (cities, type) =>
	cities.reduce((sum, city) => sum + (city.buildings[type] || 0), 0);
const queued = (country, type) =>
	country.queue.filter((order) => order.type === type);
const roleCounts = (country) =>
	Object.fromEntries(
		ROLES.map((role) => [role, country.roleCounts[role] || 0]),
	);

export function initializeCampaignAI(country, period = 0) {
	country.aiState = {
		nextDecisionPeriod: period + DECISION_INTERVAL,
		nextEconomyPeriod: period,
		nextMissionPeriod: period,
		discretionaryActions: 0,
		previousRoles: roleCounts(country),
		losses: Object.fromEntries(ROLES.map((role) => [role, 0])),
	};
	return country.aiState;
}

function budget(country, roles, extraUpkeep = 0, cost = 0) {
	const committed =
		country.upkeep +
		queued(country, "train").reduce(
			(sum, order) => sum + (roles[order.role]?.upkeep || 0),
			0,
		) +
		extraUpkeep;
	const net = country.income - committed;
	const reserveTarget = Math.max(120, committed * RESERVE_PERIODS);
	return {
		net,
		reserveTarget,
		projectedBalance: Math.floor(country.treasury - cost + net * HORIZON),
		affordable:
			country.treasury >= cost &&
			country.treasury - cost + Math.min(0, net) * HORIZON >= reserveTarget,
	};
}

function buildingCandidate(country, type, definitions) {
	const definition = definitions[type];
	let best = null;
	for (const city of ownCities(country)) {
		const pending = country.queue.filter(
			(order) =>
				order.type === "build" &&
				order.cityId === city.id &&
				order.building === type,
		).length;
		const level = (city.buildings[type] || 0) + pending;
		if (level >= definition.maxLevel) continue;
		const cost = definition.cost * (level + 1);
		if (!best || cost < best.cost) best = { city, cost };
	}
	return best;
}

function hostileAssessment(country, countries, isHostile) {
	const enemies = countries.filter(
		(other) =>
			other.active !== false && isHostile(country.sideIndex, other.sideIndex),
	);
	let airThreat = 0;
	let inbound = 0;
	for (const enemy of enemies) {
		airThreat += Math.min(
			1,
			((enemy.equipment.aircraft || 0) +
				(enemy.equipment.strikeDrone || 0) +
				(enemy.equipment.missile || 0)) /
				20,
		);
		for (const mission of enemy.missions) {
			if (
				mission.targetCountryId !== country.id ||
				mission.mission === "reconDrone"
			)
				continue;
			inbound++;
		}
	}
	return { enemies, airThreat: Math.min(1, airThreat + inbound), inbound };
}

function recruitmentCandidates(country, state, threat, roles) {
	const weights =
		country.policy === "defense"
			? { infantry: 0.55, armor: 0.1, artillery: 0.2, airDefense: 0.15 }
			: country.policy === "offense"
				? { infantry: 0.4, armor: 0.3, artillery: 0.2, airDefense: 0.1 }
				: { infantry: 0.55, armor: 0.2, artillery: 0.15, airDefense: 0.1 };
	const airShare = threat.airThreat * 0.2;
	weights.airDefense += airShare;
	weights.infantry -= airShare * 0.5;
	weights.armor -= airShare * 0.5;
	const counts = roleCounts(country);
	for (const order of queued(country, "train")) counts[order.role]++;
	const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
	return ROLES.map((role, index) => {
		const loss = state.losses[role] || 0;
		const deficit = weights[role] * (total + 1) - counts[role];
		const reason =
			role === "airDefense" && airShare > 0 && deficit > 0
				? "air_threat"
				: loss > 0
					? "replace_losses"
					: "role_balance";
		return {
			role,
			reason,
			score: deficit + Math.min(4, loss) * 0.5,
			index,
			definition: roles[role],
		};
	}).sort((a, b) => b.score - a.score || a.index - b.index);
}

function chooseMission(
	runtime,
	country,
	threat,
	definitions,
	roles,
	demand,
	equipment,
) {
	let best = null;
	for (const target of threat.enemies) {
		if (target.formations <= 0) continue;
		const effectiveness =
			1 - Math.min(0.75, (target.roleCounts.airDefense || 0) * 0.08);
		const inbound = target.missions.some(
			(mission) =>
				mission.targetCountryId === country.id &&
				mission.mission !== "reconDrone",
		);
		const threatWeight =
			Math.log2(2 + target.deployed / 1000) + (inbound ? 4 : 0);
		for (const [mission, definition] of Object.entries(definitions)) {
			if (runtime.bombsDisabled && mission !== "reconDrone") continue;
			if (
				country.equipment[mission] < 1 ||
				country.missions.some((entry) => entry.mission === mission)
			)
				continue;
			if (country.supplies - definition.supplies < demand * RESERVE_PERIODS)
				continue;
			if (!budget(country, roles, 0, definition.cost).affordable) continue;
			// Effects are aggregate game modifiers; scores reflect that model only.
			const weight =
				mission === "reconDrone"
					? country.policy === "defense" || threat.inbound
						? 1.3
						: 0.5
					: mission === "aircraft"
						? country.policy === "offense"
							? 1.6
							: country.policy === "defense"
								? 0.7
								: 1.2
						: mission === "missile"
							? 1
							: 0.9;
			const replacementCost = definition.reusable ? 0 : equipment[mission].cost;
			const score =
				(threatWeight * effectiveness * weight) /
				Math.sqrt(definition.cost + replacementCost);
			if (!best || score > best.score)
				best = {
					mission,
					targetCountryId: target.id,
					score,
					cost: definition.cost,
				};
		}
	}
	return best;
}

function automate(runtime, country, countries, context) {
	const {
		roles,
		equipment,
		buildings,
		missions,
		issue,
		isHostile,
		formationSlots,
	} = context;
	const period = runtime.campaign.period;
	const state = country.aiState;
	for (const role of ROLES) {
		const current = country.roleCounts[role] || 0;
		state.losses[role] = Math.min(
			800,
			(state.losses[role] || 0) +
				Math.max(0, (state.previousRoles[role] || 0) - current),
		);
		state.previousRoles[role] = current;
	}
	const finances = budget(country, roles);
	const explain = (action, reason, details = {}, projection = finances) => {
		country.aiDecision = {
			period,
			action,
			reason,
			reserveTarget: projection.reserveTarget,
			projectedBalance: projection.projectedBalance,
			...details,
		};
	};
	const order = (command, reason, details = {}, projection = finances) => {
		const result = issue(country.id, command);
		if (!result.ok) {
			const reasons = {
				funds: "funds_shortage",
				supplies: "supply_shortage",
				manpower: "reserve_shortage",
				equipment: "equipment_shortage",
				formation_cap: "formation_cap",
				queue_full: "queue_busy",
				no_city: "no_city",
			};
			explain("wait", reasons[result.reason] || "queue_busy", details);
			return false;
		}
		if (reason === "economy_growth" || reason === "mission_opportunity")
			state.discretionaryActions = Math.min(
				2,
				(state.discretionaryActions || 0) + 1,
			);
		explain(command.action, reason, details, projection);
		return true;
	};
	if (!country.automation) return explain("wait", "automation_off");
	const cities = ownCities(country);
	if (!cities.length) return explain("wait", "no_city");
	const threat = hostileAssessment(country, countries, isHostile);
	if (!threat.enemies.length) return explain("wait", "no_enemy");
	const training = queued(country, "train");
	const demand = Math.max(
		1,
		Math.ceil((country.formations + training.length) / 5),
	);
	const production = cities.length * 2 + levels(cities, "supply") * 20;
	const physicalShortage =
		(country.supplyStockRatio ?? 1) < 0.8 ||
		(country.supplies < demand * RESERVE_PERIODS && production < demand);
	const financialShortage =
		finances.net < 0 || (country.fundingRatio ?? 1) < 0.8;
	const pendingBuild = (type) =>
		country.queue.some(
			(entry) =>
				entry.type === "build" &&
				entry.building === type &&
				cities.some((city) => city.id === entry.cityId),
		);
	const tryBuild = (type, reason, recovery = false) => {
		if (pendingBuild(type)) {
			explain("wait", reason);
			return true;
		}
		const candidate = buildingCandidate(country, type, buildings);
		if (!candidate) return false;
		const { city, cost } = candidate;
		const projection = budget(country, roles, 0, cost);
		const wait =
			queued(country, "build").reduce(
				(sum, entry) =>
					sum +
					(cities.some((city) => city.id === entry.cityId)
						? entry.remainingPeriods
						: 0),
				0,
			) + buildings[type].duration;
		const incomeGain =
			type === "economy"
				? buildings.economy.income *
					[1, 0.9, 0.72][country.mobilization] *
					(country.policy === "economy" ? 1.2 : 1)
				: 0;
		const payback = incomeGain ? wait + cost / incomeGain : 0;
		// Corrective construction may use the buffer, but must survive its wait.
		const viableRecovery =
			recovery &&
			country.treasury >= cost &&
			country.treasury - cost + Math.min(0, finances.net) * wait >= 0;
		if (!projection.affordable && !viableRecovery) {
			explain(
				"wait",
				country.treasury < cost || finances.net < 0
					? "funds_shortage"
					: "saving_buffer",
			);
			return true;
		}
		if (type === "economy" && !recovery && payback > 40) return false;
		projection.projectedBalance += Math.floor(
			incomeGain * Math.max(0, HORIZON - wait),
		);
		if (
			order(
				{ action: "build", building: type, cityId: city.id },
				reason,
				{ cityId: city.id },
				projection,
			) &&
			type === "economy"
		)
			state.nextEconomyPeriod = period + ACTION_INTERVAL;
		return true;
	};
	// Money and supply are separate constraints: a cash shortfall never requests
	// a supply building merely because the combined combat multiplier is low.
	if (financialShortage) {
		if (tryBuild("economy", "funds_shortage", true)) return;
		return explain("wait", "funds_shortage");
	}
	if (physicalShortage) {
		if (tryBuild("supply", "supply_shortage", true)) return;
		return explain("wait", "supply_shortage");
	}
	if (country.queue.length > 3) return explain("wait", "queue_busy");
	if (
		(state.discretionaryActions || 0) < 2 &&
		period >= state.nextEconomyPeriod &&
		(country.policy === "economy" || finances.affordable)
	) {
		if (tryBuild("economy", "economy_growth")) return;
	}
	if (
		country.reserve < 2000 &&
		country.mobilization === 0 &&
		country.civilianPool > 0
	) {
		// Mobilization cuts civilian income by 10% and adds recurring upkeep.
		const forecastCountry = {
			...country,
			income: Math.floor(country.income * 0.9),
		};
		const projection = budget(forecastCountry, roles, 10, 50);
		if (projection.affordable && projection.net >= 0) {
			order(
				{ action: "mobilize", level: 1 },
				"reserve_shortage",
				{},
				projection,
			);
			return;
		}
	}
	if (
		(state.discretionaryActions || 0) < 2 &&
		period >= state.nextMissionPeriod &&
		country.formations > 0
	) {
		const selected = chooseMission(
			runtime,
			country,
			threat,
			missions,
			roles,
			demand,
			equipment,
		);
		if (selected) {
			const { mission, targetCountryId, cost } = selected;
			if (
				order(
					{ action: "mission", mission, targetCountryId },
					"mission_opportunity",
					{ mission, targetCountryId },
					budget(country, roles, 0, cost),
				)
			)
				state.nextMissionPeriod = period + ACTION_INTERVAL;
			return;
		}
	}
	// Large wars can space a country's turns beyond both optional cooldowns.
	// Reserve every third discretionary turn for its force/equipment needs.
	state.discretionaryActions = 0;
	if (formationSlots(country) < 1) return explain("wait", "formation_cap");
	if (country.reserve < 1000) return explain("wait", "reserve_shortage");
	const candidates = recruitmentCandidates(country, state, threat, roles);
	let blocked = "saving_buffer";
	for (const candidate of candidates) {
		const { role, definition, reason } = candidate;
		const shortages = Object.entries(definition.equipment)
			.map(([key, quantity]) => ({
				key,
				quantity: Math.max(0, quantity - country.equipment[key]),
			}))
			.filter((entry) => entry.quantity > 0);
		const equipmentCost = shortages.reduce(
			(sum, entry) => sum + equipment[entry.key].cost * entry.quantity,
			0,
		);
		const projection = budget(
			country,
			roles,
			definition.upkeep,
			definition.cost + equipmentCost,
		);
		if (projection.net < 0 || !projection.affordable) {
			blocked =
				projection.net < 0 || country.treasury < definition.cost + equipmentCost
					? "funds_shortage"
					: "saving_buffer";
			continue;
		}
		const futureDemand = Math.max(
			1,
			Math.ceil((country.formations + training.length + 1) / 5),
		);
		if (
			production < futureDemand &&
			country.supplies + (production - futureDemand) * HORIZON <
				futureDemand * RESERVE_PERIODS
		) {
			if (tryBuild("supply", "supply_shortage", true)) return;
			return explain("wait", "supply_shortage");
		}
		if (shortages.length) {
			const shortage = shortages[0];
			if (
				country.queue.some(
					(entry) =>
						entry.type === "production" && entry.equipment === shortage.key,
				)
			)
				return explain("wait", "equipment_shortage", {
					role,
					equipment: shortage.key,
				});
			const quantity = Math.min(10, shortage.quantity);
			order(
				{ action: "production", equipment: shortage.key, quantity },
				"equipment_shortage",
				{ role, equipment: shortage.key },
				budget(country, roles, 0, equipment[shortage.key].cost * quantity),
			);
			return;
		}
		if (
			order(
				{ action: "train", role },
				reason,
				{ role },
				budget(country, roles, definition.upkeep, definition.cost),
			)
		)
			state.losses[role] = Math.max(0, state.losses[role] - 1);
		return;
	}
	explain("wait", blocked);
}

/** Limit expensive planning to eight due countries per campaign period. */
export function advanceCampaignAI(runtime, countries, context) {
	if (!countries.length) return;
	const campaign = runtime.campaign;
	let visited = 0;
	let decisions = 0;
	let cursor = (campaign.aiCursor || 0) % countries.length;
	while (visited < countries.length && decisions < 8) {
		const country = countries[cursor];
		cursor = (cursor + 1) % countries.length;
		visited++;
		const state =
			country.aiState ||
			initializeCampaignAI(country, Math.max(0, campaign.period - 1));
		state.previousRoles ||= roleCounts(country);
		state.losses ||= Object.fromEntries(ROLES.map((role) => [role, 0]));
		state.nextEconomyPeriod ??= campaign.period;
		state.nextMissionPeriod ??= campaign.period;
		state.nextDecisionPeriod ??= campaign.period;
		if (campaign.period < state.nextDecisionPeriod) continue;
		state.nextDecisionPeriod = campaign.period + DECISION_INTERVAL;
		automate(runtime, country, countries, context);
		decisions++;
	}
	campaign.aiCursor = cursor;
}
