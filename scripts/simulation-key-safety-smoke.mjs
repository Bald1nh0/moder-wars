import assert from "node:assert/strict";
import { createAiPlanner } from "../src/ai-planning.js";
import { createAiRuntime } from "../src/ai-runtime.js";
import { createInfluenceRuntime } from "../src/influence-runtime.js";
import { createSimulationState } from "../src/simulation-state.js";
import { createSimulationWorld } from "../src/simulation-world.js";

for (const key of ["__proto__", "constructor", "prototype"]) {
	const initial = JSON.parse(`{"${key}": {"polluted": true}}`);
	assert.throws(() => createSimulationState(initial), /unsafe property/);
}
for (const sides of [{ length: 2 }, [null], ["country"], "__proto__"]) {
	assert.throws(() => createSimulationState({ sides }), /arrays of countries/);
}
assert.equal(Object.prototype.polluted, undefined);
assert.deepEqual(createSimulationState({ sides: [[], []] }).sides, [[], []]);

const strategies = ["BLITZ", "__proto__", "constructor", "unknown", 42, null];
const planner = createAiPlanner({
	sides: [
		strategies.map((strategy, id) => ({ id, strategy, initialCells: 1 })),
	],
	latestCountryStats: new Map(),
});
const profile = planner.getSideStrategyProfile(0);
assert.equal(profile.dominant, "BALANCED");
assert.deepEqual(Object.keys(profile.weights).sort(), [
	"AGGRESSIVE",
	"BALANCED",
	"BLITZ",
	"DEFENSIVE",
	"TURTLE",
]);
assert.equal(profile.weights.BALANCED, 5);
assert.equal(profile.weights.BLITZ, 1);

const invalidIndexes = [
	"__proto__",
	"constructor",
	"prototype",
	"0",
	NaN,
	0.5,
	-1,
	99,
];
const runtime = createSimulationState({
	gridWidth: 3,
	gridHeight: 3,
	landMask: new Uint8Array(9),
	units: [0, ...invalidIndexes].map((sideIndex) => ({
		sideIndex,
		health: 100,
		deployTicks: 0,
	})),
	operationalUnitPower: () => 5,
});
const world = createSimulationWorld(runtime);
const posture = world.refreshLiveCombatPower(true);
assert.deepEqual(posture.sideStrength, [5, 0]);
assert.deepEqual(posture.sideUnitCounts, [1, 0]);
assert.equal(runtime._liveSideCombatPower[0], 5);
assert.equal(Object.getPrototypeOf(posture.sideStrength), Array.prototype);

runtime._warPlan = ["first", "other", "second", "other-second"];
for (const index of invalidIndexes) world.clearSideLandPlanSlots(index);
assert.deepEqual(runtime._warPlan, [
	"first",
	"other",
	"second",
	"other-second",
]);
world.clearSideLandPlanSlots(0);
assert.deepEqual(runtime._warPlan, [null, "other", null, "other-second"]);

const ai = createAiRuntime(runtime);
for (const index of invalidIndexes) {
	ai.discardNonHostileOperationalPlans(index);
	ai.clearOperationalPlanForTaskForce(index, {});
}
assert.equal(Object.getPrototypeOf(runtime._warPlan), Array.prototype);
assert.deepEqual(runtime._warPlan, [null, "other", null, "other-second"]);
runtime._warPlan[0] = { signature: "test-plan" };
ai.clearOperationalPlanForTaskForce(0, { planSignature: "test-plan" });
assert.equal(runtime._warPlan[0], null);
assert.equal(runtime._planReassessNeeded[0], true);

const influence = createInfluenceRuntime(runtime);
influence.ensureInfluenceFrontierQueue();
for (const index of invalidIndexes) {
	assert.equal(influence.enqueueInfluenceFrontierIndex(index, true), false);
	influence.queueInfluenceFrontierCell(index, true);
}
assert.equal(runtime._influenceFrontierPriorityQueue.length, 0);
assert.equal(influence.enqueueInfluenceFrontierIndex(4, true), true);
runtime._influenceFrontierPriorityQueue.unshift(...invalidIndexes);
influence.processInfluenceFrontierDiffusion(1);
assert.equal(runtime._influenceFrontierQueued[4], 0);
assert.equal(
	runtime._influenceFrontierPriorityCursor,
	invalidIndexes.length + 1,
);
assert.equal(
	Object.hasOwn(runtime._influenceFrontierQueued, "constructor"),
	false,
);
console.log(
	"Simulation key safety: unsafe state, strategy and array indexes rejected; valid behavior preserved.",
);
