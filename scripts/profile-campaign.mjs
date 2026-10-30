#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, platform } from "node:os";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { createArmyFormation } from "../src/army-formation.js";
import { advanceCampaign, initializeCampaign } from "../src/campaign-core.js";
import { getCountryForceProfiles } from "../src/country-force-profiles.js";
import {
	createSparseInfluenceMap,
	writeInfluence,
} from "../src/influence-grid.js";
import { decodeScenarioBinary } from "../src/scenario-codec.js";
import { createSimulationCore } from "../src/simulation-core.js";
import {
	createControlDeltaTracker,
	createPresentationSnapshot,
	createPresentationSnapshotCache,
} from "../src/simulation-protocol.js";
import { createSimulationState } from "../src/simulation-state.js";
import { repeatableRandom } from "./profiling/fixture.mjs";
import { distribution } from "./profiling/statistics.mjs";

const options = {
	unitsPerSide: 600,
	gridRes: 0.15,
	warmup: 30,
	periods: 300,
	snapshots: 100,
};
const keys = new Map([
	["--units-per-side", "unitsPerSide"],
	["--grid-res", "gridRes"],
	["--warmup", "warmup"],
	["--periods", "periods"],
	["--snapshots", "snapshots"],
	["--outdir", "outdir"],
]);
const args = process.argv.slice(2);
if (args.includes("--help")) {
	console.log(
		"Usage: node scripts/profile-campaign.mjs [--units-per-side 600] [--grid-res 0.15] [--warmup 30] [--periods 300] [--snapshots 100] [--outdir DIR]\nMeasures Node campaign updates and presentation preparation on the packaged Ukraine 2023 map. It does not run rendering or the full simulation tick.",
	);
	process.exit(0);
}
for (let index = 0; index < args.length; index++) {
	const key = keys.get(args[index]);
	if (!key || !args[index + 1] || args[index + 1].startsWith("--"))
		throw new Error(`Unknown option or missing value: ${args[index]}`);
	options[key] = key === "outdir" ? args[++index] : Number(args[++index]);
}
for (const key of ["unitsPerSide", "warmup", "periods", "snapshots"]) {
	if (
		!Number.isSafeInteger(options[key]) ||
		options[key] < (key === "warmup" ? 0 : 1) ||
		options[key] > 10_000
	)
		throw new Error(`Invalid ${key}`);
}
if (
	options.unitsPerSide > 2400 ||
	![0.25, 0.15, 0.1, 0.05].includes(options.gridRes)
)
	throw new Error(
		"Use at most 2400 formations per side and a supported grid resolution",
	);

function createUkraineFixture() {
	const map = readFileSync(
		new URL("../assets/maps/compiled/ukraine-2023-v3.mwsc.gz", import.meta.url),
	);
	const decoded = decodeScenarioBinary(gunzipSync(map), {
		targetGridRes: options.gridRes,
	});
	const metadata = [];
	for (const country of decoded.scenario.metadata)
		if (country) metadata[country.id - 1] = structuredClone(country);
	const countries = ["Ukraine", "Russia"].map((name) => {
		const country = metadata.find((entry) => entry?.name === name);
		if (!country) throw new Error(`Map has no ${name}`);
		return {
			...country,
			role: "OFFENSE",
			strategy: "BALANCED",
			buffState: "none",
			hiddenBuffState: "none",
			troops: options.unitsPerSide * 1250,
			initialCells: 0,
		};
	});
	const { width: gridWidth, height: gridHeight, length } = decoded.target;
	const sideByCountry = new Map(
		countries.map((country, side) => [country.id, side]),
	);
	const state = createSimulationState({
		CONFIG: {
			GRID_RES: options.gridRes,
			MAX_UNITS_PER_SIDE: Math.min(2400, options.unitsPerSide * 2),
		},
		gridWidth,
		gridHeight,
		simSpeed: 1,
		gameState: "SIMULATING",
		isPaused: false,
		peaceTreatiesDisabled: true,
		bombsDisabled: true,
		warGraceEndTick: 100_000,
		countryMetadata: metadata,
		sides: countries.map((country) => [country]),
		worldControlMap: decoded.worldControl,
		deJureMap: decoded.deJure,
		provinceMap: decoded.province,
		biomeMask: decoded.biome,
		landMask: decoded.land,
		terrainMask: new Float32Array(length),
		primaryOccupierMap: new Uint16Array(length),
		dominantSideMap: new Int8Array(length).fill(-1),
		occupationMap: new Float32Array(length),
		sideInfluenceMaps: countries.map(() => createSparseInfluenceMap(length)),
	});
	const cells = countries.map(() => []);
	for (let index = 0; index < length; index++) {
		const side = sideByCountry.get(state.worldControlMap[index]);
		if (side === undefined) continue;
		cells[side].push(index);
		state.landMask[index] = 2;
		state.primaryOccupierMap[index] = countries[side].id;
		state.dominantSideMap[index] = side;
		writeInfluence(state.sideInfluenceMaps[side], index, 1);
		state.occupationMap[index] = side === 0 ? 1 : -1;
	}
	const gridIndex = (lat, lng) =>
		Math.floor((lat + 90) / options.gridRes) * gridWidth +
		Math.floor((lng + 180) / options.gridRes);
	state.cities = decoded.scenario.cities.map((city) => {
		const index = gridIndex(city.lat, city.lng);
		const ownerId = state.worldControlMap[index] || 0;
		return {
			...city,
			ownerId,
			sovereignId: state.deJureMap[index] || ownerId,
			countryId: ownerId,
		};
	});
	state.activeTheaterCities = state.cities.filter((city) =>
		sideByCountry.has(city.ownerId),
	);
	state.sideUids = ["campaign-profile-0", "campaign-profile-1"];
	state.hostileSidePairs = new Set([state.sideUids.join("|")]);
	state.hostilityMatrix[1] = state.hostilityMatrix[state.MAX_SIDES] = 1;
	const random = repeatableRandom();
	for (const [side, country] of countries.entries()) {
		country.initialCells = cells[side].length;
		if (!country.initialCells) throw new Error(`No cells for ${country.name}`);
		state.sideSoldiers[side] = state.initialSideSoldiers[side] =
			options.unitsPerSide * 1250;
		state.sideRecruitableManpower[side] = options.unitsPerSide * 250;
		for (let unit = 0; unit < options.unitsPerSide; unit++) {
			const index = cells[side][Math.floor(random() * cells[side].length)];
			state.units.push(
				createArmyFormation(
					{
						id: random(),
						sideIndex: side,
						sovereignId: country.id,
						lat: (Math.floor(index / gridWidth) + 0.5) * options.gridRes - 90,
						lng: ((index % gridWidth) + 0.5) * options.gridRes - 180,
						health: 100,
						maxHealth: 100,
						personnel: 1000,
						personnelCapacity: 1000,
						deployTicks: 0,
					},
					state.CONFIG,
				),
			);
		}
	}
	state.initialCombatants = countries.map((country, sideIndex) => ({
		id: country.id,
		name: country.name,
		sideIndex,
	}));
	state.initialOwnerMap = state.deJureMap.slice();
	return {
		state,
		fixture: {
			map: "assets/maps/compiled/ukraine-2023-v3.mwsc.gz",
			mapSha256: createHash("sha256").update(map).digest("hex"),
			gridRes: options.gridRes,
			gridWidth,
			gridHeight,
			cells: length,
			countries: countries.map(({ id, name }) => ({ id, name })),
			initialFormations: state.units.length,
			initialPersonnel: state.units.length * 1000,
			cityCount: state.cities.length,
			selectedCells: cells.map((entries) => entries.length),
			configSha256: createHash("sha256")
				.update(JSON.stringify(state.CONFIG))
				.digest("hex"),
		},
	};
}

function measure(run, samples) {
	for (let sample = 0; sample < options.warmup; sample++) run();
	const values = [];
	for (let sample = 0; sample < samples; sample++) {
		const started = performance.now();
		run();
		values.push(performance.now() - started);
	}
	return distribution(values, { budget: null });
}

const built = createUkraineFixture();
const state = createSimulationCore(built.state).state;
const profiles = getCountryForceProfiles(state.countryMetadata, "2023-01-01");
const started = performance.now();
initializeCampaign(state, { profiles });
const initializeMs = performance.now() - started;
state.campaign.scenarioDate = "2023-01-01";
const report = {
	version: 1,
	measuredAt: new Date().toISOString(),
	host: { node: process.version, cpu: cpus()[0]?.model, platform: platform() },
	options,
	fixture: built.fixture,
	initializeMs,
	notes: [
		"Node CPU microbenchmark only; no browser rendering, networking, full simulation tick, region polling or combat.",
		"Packaged Ukraine 2023 geography with deterministic synthetic army placement; this is not the browser-start formation distribution.",
		"Territory stays fixed while abstract campaign periods advance. AI can build, produce and train within the normal rules.",
		"Snapshot phases share the same final army. Each snapshot advances two logical ticks, modeling 30 snapshots per logical second at speed 1.",
		"Reserve-mutating probes simulate publication pressure; they are not combat or mobilization measurements.",
		"Forced-command snapshots increment the command revision every sample, measuring an intentionally excessive immediate-publication workload.",
		"Warmup and phases share state; these are isolated component costs, not evidence that campaign games are faster than legacy games.",
	],
};
for (const country of Object.values(state.campaign.countries))
	country.automation = false;
report.economyWithoutAI = measure(() => {
	state._simTickCount += 120;
	advanceCampaign(state);
}, options.periods);
for (const country of Object.values(state.campaign.countries))
	country.automation = true;
report.economyWithAI = measure(() => {
	state._simTickCount += 120;
	advanceCampaign(state);
}, options.periods);
report.finalFormations = state.units.length;
report.countries = Object.values(state.campaign.countries).map((country) => ({
	id: country.id,
	cities: country.cities.length,
	formations: country.formations,
}));
const campaign = state.campaign;

function snapshotProbe({
	enabled,
	mutateReserve = false,
	forceCommand = false,
}) {
	state.campaign = enabled ? campaign : null;
	const tracker = createControlDeltaTracker(state);
	const cache = createPresentationSnapshotCache();
	let published = 0;
	const country = Object.values(campaign.countries)[0];
	const timing = measure(() => {
		state._simTickCount += 2;
		if (mutateReserve) {
			country.reserve++;
			state.sideRecruitableManpower[country.sideIndex]++;
			state.sideSoldiers[country.sideIndex]++;
		}
		if (forceCommand)
			campaign.commandRevision = (campaign.commandRevision || 0) + 1;
		const snapshot = createPresentationSnapshot(state, tracker, { cache });
		if (Object.hasOwn(snapshot.values, "campaign")) published++;
	}, options.snapshots);
	return { ...timing, campaignPublicationsIncludingWarmup: published };
}
report.snapshotWithoutCampaign = snapshotProbe({ enabled: false });
report.snapshotUnchangedCampaign = snapshotProbe({ enabled: true });
report.snapshotChangingReserve = snapshotProbe({
	enabled: true,
	mutateReserve: true,
});
report.snapshotEveryCommand = snapshotProbe({
	enabled: true,
	mutateReserve: true,
	forceCommand: true,
});
report.campaignJsonBytes = Buffer.byteLength(JSON.stringify(campaign));
const output = resolve(
	options.outdir ||
		`performance-results/campaign-${report.measuredAt.replaceAll(":", "-")}`,
);
mkdirSync(output, { recursive: true });
const filename = resolve(output, "report.json");
writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`);
console.log(
	JSON.stringify(
		{
			report: filename,
			initializeMs: report.initializeMs,
			economyWithAI: report.economyWithAI,
			snapshotWithoutCampaign: report.snapshotWithoutCampaign,
			snapshotChangingReserve: report.snapshotChangingReserve,
			campaignJsonBytes: report.campaignJsonBytes,
		},
		null,
		2,
	),
);
