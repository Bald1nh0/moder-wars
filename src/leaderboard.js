import { getFormationPersonnel } from "./formation-strength.js";
import { gameText } from "./i18n.js";

/** Read actual deployed forces from the presentation mirror, never recruitment estimates. */
export function buildLeaderboardRows({
	countryMetadata = [],
	worldControlMap = [],
	units = [],
	getPersonnel = getFormationPersonnel,
	countryName = (meta) => meta.displayName || meta.name || "",
	countryFlag = (meta) => meta.tempFlag?.src || meta.flagUrl || "",
}) {
	const rows = new Map();
	let maxId = 0;
	for (const meta of countryMetadata) {
		if (
			!meta ||
			!Number.isInteger(meta.id) ||
			meta.id <= 0 ||
			meta.id > 65_535 ||
			meta.name === "Antarctica"
		)
			continue;
		maxId = Math.max(maxId, meta.id);
		rows.set(meta.id, {
			id: meta.id,
			name: countryName(meta),
			flagUrl: countryFlag(meta),
			tiles: 0,
			units: 0,
			personnel: 0,
		});
	}
	// One world scan for the whole table, rather than one scan for every country.
	const tileCounts = new Uint32Array(maxId + 1);
	for (const id of worldControlMap) {
		if (id > 0 && id <= maxId) tileCounts[id]++;
	}
	for (const row of rows.values()) row.tiles = tileCounts[row.id];
	for (const unit of units) {
		if (!(unit?.health > 0)) continue;
		const row = rows.get(unit.sovereignId);
		if (!row) continue;
		row.units++;
		row.personnel += getPersonnel(unit);
	}
	return [...rows.values()].sort(
		(a, b) =>
			b.personnel - a.personnel ||
			b.units - a.units ||
			b.tiles - a.tiles ||
			a.name.localeCompare(b.name),
	);
}

/** Render exact counts with text nodes so scenario names cannot become markup. */
export function renderLeaderboard(
	rows,
	{ container, note, documentRef = document },
) {
	const fragment = documentRef.createDocumentFragment();
	const create = (tag, className, text) => {
		const node = documentRef.createElement(tag);
		node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	};
	rows.forEach((row, index) => {
		const element = create("div", "leaderboard-row");
		element.dataset.countryId = String(row.id);
		const flag = create(row.flagUrl ? "img" : "span", "leaderboard-flag");
		if (row.flagUrl) {
			flag.src = row.flagUrl;
			flag.alt = "";
			flag.loading = "lazy";
		}
		element.append(
			create("span", "leaderboard-rank", String(index + 1)),
			flag,
			create("span", "leaderboard-country", row.name),
		);
		for (const [className, key, value] of [
			["leaderboard-tiles", "UI_LEADERBOARD_TERRITORY", row.tiles],
			["leaderboard-units", "UI_UNITS", row.units],
			["leaderboard-personnel", "UI_LEADERBOARD_DEPLOYED", row.personnel],
		]) {
			const number = Math.max(0, Math.round(value)).toLocaleString();
			const cell = create("span", className, number);
			cell.setAttribute("aria-label", `${gameText(key)}: ${number}`);
			element.append(cell);
		}
		fragment.append(element);
	});
	container.replaceChildren(fragment);
	if (note) {
		const empty = !rows.some((row) => row.units > 0);
		note.textContent = `${empty ? `${gameText("UI_LEADERBOARD_EMPTY")} ` : ""}${gameText("UI_LEADERBOARD_NOTE")}`;
	}
}
