import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLeaderboardRows, renderLeaderboard } from "../src/leaderboard.js";
import { getFormationPersonnel } from "../src/formation-strength.js";

const metadata = [
	{ id: 1, name: "Ukraine", flagUrl: "https://example.test/ua.png" },
	{ id: 2, name: "Russia" },
	{ id: 3, name: "Neutral" },
	{ id: 4, name: "Exiled" },
	{ id: 5, name: "Antarctica" },
];
const control = new Uint16Array([2, 2, 2, 1, 3, 3, 5, 5]);
const units = [
	{ sovereignId: 1, sideIndex: 0, health: 80, personnel: 12_345 },
	{ sovereignId: 1, sideIndex: 0, health: 50, maxHealth: 100 },
	{ sovereignId: 1, sideIndex: 0, health: 0, personnel: 99_999 },
	{ sovereignId: 1, sideIndex: 0, health: -1, personnel: 90_000 },
	{ sovereignId: 2, sideIndex: 1, health: 100, personnel: 1_234_567 },
	{ sovereignId: 4, sideIndex: 0, health: 100, personnel: 800 },
	{ sovereignId: 999, sideIndex: 1, health: 100, personnel: 10_000 },
];
const options = {
	countryMetadata: metadata,
	worldControlMap: control,
	units,
	getPersonnel: (unit) =>
		getFormationPersonnel(unit, { nominalPersonnel: 4000, baseHealth: 100 }),
};
const rows = buildLeaderboardRows(options);
const byId = new Map(rows.map((row) => [row.id, row]));
assert.deepEqual(rows.map((row) => row.id), [2, 1, 4, 3]);
assert.equal(byId.get(1).units, 2, "Only surviving actual formations count");
assert.equal(byId.get(1).personnel, 14_345, "Explicit personnel plus actual legacy strength, not fixed 1000 per flag");
assert.equal(byId.get(1).tiles, 1, "Territorial control is independent of unit nationality");
assert.equal(byId.get(2).units, 1);
assert.equal(byId.get(2).personnel, 1_234_567);
assert.equal(byId.get(3).units, 0, "Neutral countries have no phantom estimated formations");
assert.equal(byId.get(3).personnel, 0);
assert.equal(byId.get(4).tiles, 0, "Forces remain counted even after loss of all home tiles");
assert.equal(byId.get(4).units, 1);
assert.equal(rows.some((row) => row.id === 5), false, "Antarctica remains excluded");
assert.equal(rows.some((row) => row.id === 999), false, "Unknown metadata cannot invent a country");
assert.equal(rows.reduce((sum, row) => sum + row.units, 0), 4);

// A later presentation snapshot replaces strength and removes a destroyed unit.
const changed = buildLeaderboardRows({
	...options,
	units: [
		{ sovereignId: 1, health: 25, personnel: 123 },
		{ sovereignId: 2, health: 0, personnel: 1_234_567 },
	],
});
assert.equal(changed[0].id, 1);
assert.equal(changed[0].personnel, 123);
assert.equal(changed.find((row) => row.id === 2).units, 0);
const beforeWar = buildLeaderboardRows({ ...options, units: [] });
assert.ok(beforeWar.every((row) => row.units === 0 && row.personnel === 0));
assert.deepEqual(buildLeaderboardRows({}), []);

class Node {
	constructor(tag = "div") {
		this.tagName = tag;
		this.children = [];
		this.dataset = {};
		this.attributes = {};
		this.textContent = "";
	}
	append(...children) { this.children.push(...children); }
	replaceChildren(fragment) { this.children = [...fragment.children]; }
	setAttribute(key, value) { this.attributes[key] = value; }
}
const container = new Node(), note = new Node();
const documentRef = {
	createElement: (tag) => new Node(tag),
	createDocumentFragment: () => new Node("fragment"),
};
const displayRows = rows.map((row) => ({ ...row }));
displayRows[0].name = '<img src="x" onerror="alert(1)">';
renderLeaderboard(displayRows, { container, note, documentRef });
assert.equal(container.children.length, 4);
const first = container.children[0];
assert.equal(first.children[2].textContent, displayRows[0].name, "Names remain literal text");
assert.equal(first.children[4].textContent, "1", "Units are counts, not personnel");
assert.equal(first.children[5].textContent, (1_234_567).toLocaleString(), "Personnel is shown without lossy abbreviation");
assert.match(first.children[5].attributes["aria-label"], /Deployed soldiers/);
assert.match(note.textContent, /Shared reserves are excluded/);
renderLeaderboard(beforeWar, { container, note, documentRef });
assert.match(note.textContent, /No units are currently deployed/);
assert.ok(container.children.every((row) => row.children[4].textContent === "0"));
renderLeaderboard([], { container, note, documentRef });
assert.equal(container.children.length, 0, "Refreshing removes stale rows");

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const start = main.indexOf("function refreshLeaderboard(");
const end = main.indexOf("// The simulation stops proposing peace", start);
assert.ok(start >= 0 && end > start);
assert.doesNotMatch(main.slice(start, end), /estimateUnitsForCountry/);
assert.match(main.slice(start, end), /getPersonnel: getLiveFormationPersonnel/);
assert.match(main, /const realNow = performance\.now\(\);\s*refreshLeaderboard\(\)/);
assert.match(main, /updateWarOverview\(true\);\s*refreshLeaderboard\(true\)/);
console.log("Leaderboard: actual live formations, exact personnel, casualties, neutral/prewar zeros, safe rendering and refresh wiring passed");
