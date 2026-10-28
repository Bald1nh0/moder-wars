import {
	normalizeCountryIso3,
	resolveCountryRelationship,
} from "./country-force-profiles.js";

const EVENT_LIMIT = 200;
const POLL_TICKS = 60;
const CITY_BUDGET = 2048;
const REGION_CELL_BUDGET = 2048;
const TYPES = new Set([
	"building_started",
	"building_completed",
	"training_started",
	"training_completed",
	"production_started",
	"production_completed",
	"mobilization",
	"policy",
	"mission",
	"demobilized",
	"shortage",
	"city_captured",
	"capital_captured",
	"country_capitulated",
	"dependency_changed",
	"region_control_changed",
	"order_cancelled",
	"peace_signed",
]);
const numberKeys = [
	"countryId",
	"previousCountryId",
	"controllerId",
	"overlordId",
	"previousOverlordId",
	"targetCountryId",
	"quantity",
	"level",
	"share",
	"cost",
];
const stringKeys = [
	"cityId",
	"cityName",
	"role",
	"building",
	"equipment",
	"mission",
	"reason",
	"policy",
	"regionId",
	"control",
];
// biome-ignore lint/suspicious/noControlCharactersInRegex: Strip control characters from imported display metadata.
const UNSAFE_TEXT = /[\u0000-\u001f<>]/g;
const cleanText = (value, max = 160) =>
	typeof value === "string" ? value.replace(UNSAFE_TEXT, "").slice(0, max) : "";
const tickOf = (runtime) =>
	Number.isSafeInteger(runtime._simTickCount) && runtime._simTickCount >= 0
		? runtime._simTickCount
		: 0;
const owner = (value) =>
	Number.isInteger(value) && value > 0 && value <= 65535 ? value : 0;

/** A bounded journal belongs to the simulation owner and survives ownership handoffs. */
export function emitCampaignEvent(runtime, type, payload = {}) {
	const campaign = runtime.campaign;
	if (!campaign?.enabled || !TYPES.has(type)) return null;
	if (!Array.isArray(campaign.events)) campaign.events = [];
	const lastId = campaign.events.at(-1)?.id || 0;
	const nextId =
		Number.isSafeInteger(campaign.nextEventId) && campaign.nextEventId > lastId
			? campaign.nextEventId
			: lastId + 1;
	const event = { id: nextId, tick: tickOf(runtime), type };
	for (const key of numberKeys) {
		const value = payload[key];
		if (
			typeof value === "number" &&
			Number.isFinite(value) &&
			value >= 0 &&
			value <= 1e16
		)
			event[key] = value;
	}
	for (const key of stringKeys) {
		const value =
			key === "cityId" && typeof payload[key] === "number"
				? String(payload[key])
				: cleanText(payload[key]);
		if (value) event[key] = value;
	}
	if (payload.regionNames && typeof payload.regionNames === "object")
		event.regionNames = Object.fromEntries(
			["en", "uk", "ru"].map((lang) => [
				lang,
				cleanText(payload.regionNames[lang]),
			]),
		);
	campaign.nextEventId = nextId + 1;
	campaign.events.push(event);
	if (campaign.events.length > EVENT_LIMIT)
		campaign.events.splice(0, campaign.events.length - EVENT_LIMIT);
	return event;
}

export function resetCampaignEvents(runtime) {
	if (!runtime.campaign) return;
	runtime.campaign.events = [];
	runtime.campaign.nextEventId = 1;
	runtime.campaign.eventBaseline = null;
	if (runtime.campaign.regions) {
		runtime.campaign.regions.cursor = 0;
		for (const region of runtime.campaign.regions.regions || []) {
			region.cursor = 0;
			region.counts = {};
			region.summary = null;
			region.candidate = null;
		}
	}
}

/** Record the authoritative transition even when capitulation ends the current tick early. */
export function recordCampaignCapitulation(runtime, country, controllerId = 0) {
	if (!owner(country?.id)) return null;
	const event = emitCampaignEvent(runtime, "country_capitulated", {
		countryId: country.id,
		...(owner(controllerId) ? { controllerId } : {}),
	});
	if (!event) return null;
	const previous = runtime.campaign.eventBaseline?.countries?.[country.id];
	// The next coarse observation must not repeat an already emitted transition.
	if (previous) previous.active = false;
	return event;
}

function gridIndex(runtime, city) {
	if (!Number.isFinite(city.lat) || !Number.isFinite(city.lng)) return -1;
	if (typeof runtime.getGridIndex === "function")
		return runtime.getGridIndex(city.lat, city.lng);
	const res = runtime.CONFIG?.GRID_RES;
	if (!(res > 0)) return -1;
	const x = Math.floor((city.lng + 180) / res);
	const y = Math.floor((city.lat + 90) / res);
	return x >= 0 && x < runtime.gridWidth && y >= 0 && y < runtime.gridHeight
		? y * runtime.gridWidth + x
		: -1;
}

function cellController(runtime, index) {
	if (index < 0 || index >= (runtime.worldControlMap?.length || 0)) return 0;
	return (
		owner(runtime.primaryOccupierMap?.[index]) ||
		owner(runtime.worldControlMap[index])
	);
}

function updateCities(runtime, baseline) {
	// Keep source indices stable even when the active theater contains only a subset.
	const cities = runtime.cities || [];
	if (!cities.length) return;
	const count = Math.min(cities.length, CITY_BUDGET);
	for (let offset = 0; offset < count; offset++) {
		const index = (baseline.cityCursor + offset) % cities.length;
		const city = cities[index];
		if (!city) continue;
		const key = String(city.id ?? `city-${index}`);
		const controllerId = cellController(runtime, gridIndex(runtime, city));
		if (!controllerId) continue;
		const previous = baseline.cities[`city:${key}`];
		if (previous !== undefined && previous !== controllerId)
			emitCampaignEvent(
				runtime,
				city.isCapital ? "capital_captured" : "city_captured",
				{
					countryId: controllerId,
					previousCountryId: previous,
					cityId: key,
					cityName: city.name || "",
				},
			);
		baseline.cities[`city:${key}`] = controllerId;
	}
	baseline.cityCursor = (baseline.cityCursor + count) % cities.length;
}

function updateCountries(runtime, baseline) {
	const active = new Set(
		(runtime.sides || [])
			.flat()
			.filter(Boolean)
			.map((country) => country.id),
	);
	for (const country of runtime.countryMetadata || []) {
		if (!country || !owner(country.id)) continue;
		const previous = baseline.countries[country.id];
		const current = {
			active: active.has(country.id),
			overlordId: owner(country.overlordId),
			releasableBy: owner(country.releasableBy),
		};
		const campaignCountry = runtime.campaign.countries?.[country.id];
		if (
			campaignCountry &&
			(!previous || previous.overlordId !== current.overlordId)
		) {
			campaignCountry.relationship = resolveCountryRelationship(
				country,
				runtime.countryMetadata,
				runtime.campaign.scenarioDate || runtime.gameTimeDate,
			);
		}
		if (previous) {
			if (previous.overlordId !== current.overlordId)
				emitCampaignEvent(runtime, "dependency_changed", {
					countryId: country.id,
					overlordId: current.overlordId,
					previousOverlordId: previous.overlordId,
				});
			if (
				previous.active &&
				!current.active &&
				current.releasableBy > 0 &&
				previous.releasableBy !== current.releasableBy
			)
				emitCampaignEvent(runtime, "country_capitulated", {
					countryId: country.id,
					controllerId: current.releasableBy,
				});
		}
		baseline.countries[country.id] = current;
	}
}

function pointInRegion(lng, lat, rings) {
	let inside = false;
	for (const ring of rings) {
		for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
			const x = ring[i],
				y = ring[i + 1],
				previousX = ring[j],
				previousY = ring[j + 1];
			if (
				y > lat !== previousY > lat &&
				lng < ((previousX - x) * (lat - y)) / (previousY - y) + x
			)
				inside = !inside;
		}
	}
	return inside;
}

/** Build once from administrative polygons, never from synthetic game provinces. */
export function buildCampaignRegionIndex(
	runtime,
	sourceRegions,
	{ countryCodes = ["UKR"], maxCells = 300000 } = {},
) {
	const res = runtime.CONFIG?.GRID_RES;
	const width = runtime.gridWidth,
		height = runtime.gridHeight;
	if (
		!(res > 0) ||
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		!runtime.landMask ||
		!Array.isArray(sourceRegions)
	)
		return null;
	const selected = new Set(countryCodes);
	const sovereignIds = new Map(
		(runtime.countryMetadata || [])
			.filter(Boolean)
			.map((country) => [normalizeCountryIso3(country), owner(country.id)]),
	);
	const regions = [];
	const assigned = new Set();
	for (const region of sourceRegions) {
		if (
			!selected.has(region.country) ||
			!Array.isArray(region.bbox) ||
			!region.bbox.every(Number.isFinite) ||
			!Array.isArray(region.rings)
		)
			continue;
		if (
			!region.rings.every(
				(ring) =>
					Array.isArray(ring) &&
					ring.length >= 6 &&
					ring.length % 2 === 0 &&
					ring.every(Number.isFinite),
			)
		)
			continue;
		const [west, south, east, north] = region.bbox;
		const sovereignId = sovereignIds.get(region.country);
		// This optional index currently covers bounded regional theaters, not antimeridian polygons.
		if (east - west > 180 || east < west) continue;
		const minX = Math.max(0, Math.floor((west + 180) / res));
		const maxX = Math.min(width - 1, Math.floor((east + 180) / res));
		const minY = Math.max(0, Math.floor((south + 90) / res));
		const maxY = Math.min(height - 1, Math.floor((north + 90) / res));
		const cells = [];
		for (let y = minY; y <= maxY; y++)
			for (let x = minX; x <= maxX; x++) {
				const index = y * width + x;
				if (
					!runtime.landMask[index] ||
					(sovereignId &&
						runtime.deJureMap &&
						runtime.deJureMap[index] !== sovereignId) ||
					assigned.has(index) ||
					!pointInRegion(
						(x + 0.5) * res - 180,
						(y + 0.5) * res - 90,
						region.rings,
					)
				)
					continue;
				if (assigned.size >= maxCells)
					throw new RangeError("Campaign region cell budget exceeded");
				cells.push(index);
				assigned.add(index);
			}
		if (cells.length)
			regions.push({
				id: cleanText(region.id),
				names: Object.fromEntries(
					["en", "uk", "ru"].map((lang) => [
						lang,
						cleanText(region.names?.[lang]),
					]),
				),
				cells,
				cursor: 0,
				counts: {},
				summary: null,
				candidate: null,
			});
	}
	return {
		version: 1,
		gridWidth: width,
		gridHeight: height,
		cursor: 0,
		regions,
	};
}

function finishRegion(runtime, region) {
	const ranked = Object.entries(region.counts)
		.map(([countryId, count]) => [Number(countryId), count])
		.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
	const [countryId = 0, count = 0] = ranked[0] || [];
	const share = count / region.cells.length;
	const previous = region.summary;
	// A 70% exit threshold prevents repeated majority changes around the 75% entry threshold.
	const majorityThreshold =
		previous?.control === "majority" && previous.countryId === countryId
			? 0.7
			: 0.75;
	const control =
		countryId && count === region.cells.length
			? "full"
			: countryId && share >= majorityThreshold
				? "majority"
				: "contested";
	const result = {
		countryId: control === "contested" ? 0 : countryId,
		controllerId: countryId,
		control,
		share,
	};
	if (!previous) region.summary = result;
	else if (
		previous.countryId !== result.countryId ||
		previous.control !== result.control
	) {
		// Require two complete passes; a single cell or an incomplete sample cannot claim an oblast.
		if (
			region.candidate?.countryId === result.countryId &&
			region.candidate?.controllerId === result.controllerId &&
			region.candidate?.control === result.control
		) {
			emitCampaignEvent(runtime, "region_control_changed", {
				regionId: region.id,
				regionNames: region.names,
				countryId: result.countryId,
				controllerId: result.controllerId,
				previousCountryId: previous.countryId,
				control,
				share,
			});
			region.summary = result;
			region.candidate = null;
		} else region.candidate = result;
	} else {
		region.summary = result;
		region.candidate = null;
	}
	region.cursor = 0;
	region.counts = {};
}

function updateRegions(runtime) {
	const state = runtime.campaign.regions;
	if (
		!state?.regions?.length ||
		state.gridWidth !== runtime.gridWidth ||
		state.gridHeight !== runtime.gridHeight
	)
		return;
	let budget = REGION_CELL_BUDGET;
	let completed = 0;
	while (budget > 0 && completed < state.regions.length) {
		const region = state.regions[state.cursor];
		if (!region?.cells?.length) break;
		while (budget > 0 && region.cursor < region.cells.length) {
			const controller = cellController(runtime, region.cells[region.cursor++]);
			region.counts[controller] = (region.counts[controller] || 0) + 1;
			budget--;
		}
		if (region.cursor < region.cells.length) break;
		finishRegion(runtime, region);
		state.cursor = (state.cursor + 1) % state.regions.length;
		completed++;
	}
}

/** Coarse, bounded polling is independent of rendering and works in either owner. */
export function updateCampaignEvents(runtime) {
	const campaign = runtime.campaign;
	if (!campaign?.enabled) return;
	const tick = tickOf(runtime);
	let baseline = campaign.eventBaseline;
	if (baseline && tick < baseline.lastTick) {
		resetCampaignEvents(runtime);
		baseline = null;
	}
	if (baseline && tick - baseline.lastTick < POLL_TICKS) return;
	if (!baseline)
		campaign.eventBaseline = baseline = {
			lastTick: tick,
			cityCursor: 0,
			cities: {},
			countries: {},
		};
	baseline.lastTick = tick;
	updateCities(runtime, baseline);
	updateCountries(runtime, baseline);
	updateRegions(runtime);
}
