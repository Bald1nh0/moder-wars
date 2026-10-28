import {
	CAMPAIGN_BUILDINGS,
	CAMPAIGN_EQUIPMENT,
	CAMPAIGN_MISSIONS,
	CAMPAIGN_ROLES,
} from "./campaign-core.js";
import { getFormationPersonnel } from "./formation-strength.js";
import { gameText, getLanguage } from "./i18n.js";

const ROLE_KEYS = Object.keys(CAMPAIGN_ROLES);
const EQUIPMENT_KEYS = Object.keys(CAMPAIGN_EQUIPMENT);
const BUILDING_KEYS = Object.keys(CAMPAIGN_BUILDINGS);
const MISSION_KEYS = Object.keys(CAMPAIGN_MISSIONS);
const POLICY_KEYS = ["balanced", "offense", "defense", "economy"];
const EVENT_TYPES = new Set([
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
const OBSERVATION_KEYS = [
	"tank",
	"artillery",
	"airDefense",
	"combatAircraft",
	"aircraftTotal",
	"uavSystems",
	"armouredVehicles",
	"missiles",
	"strikeDrones",
];
const NOTIFICATIONS_KEY = "mw.campaign.notifications";
const number = (value) =>
	Math.round(Number.isFinite(Number(value)) ? Number(value) : 0).toLocaleString(
		getLanguage(),
	);
const countryName = (runtime, id, translate = gameText) => {
	const metadata = runtime.countryMetadata?.find(
		(country) => country?.id === Number(id),
	);
	return (
		metadata?.displayName ||
		metadata?.name ||
		translate("CAMPAIGN_SOURCE_UNKNOWN")
	);
};

/** Keep completed ledgers readable while the same map returns to side selection. */
export function campaignPanelState(runtime) {
	if (!runtime.campaign?.enabled) return { visible: false, editable: false };
	const playing = runtime.gameState === "SIMULATING";
	const selecting = ["SELECTING_P1", "SELECTING_P2"].includes(
		runtime.gameState,
	);
	return {
		visible:
			playing ||
			runtime.gameState === "WAR_OVER" ||
			(selecting && runtime.campaign.finished === true),
		editable: playing && runtime.campaign.finished !== true,
	};
}

export function campaignOrdersReady(runtime) {
	const status = runtime.simulationClient?.diagnostics?.status;
	return status === undefined || status === "ready";
}

/** Count the current mirror, rather than a previous logistics-cycle estimate. */
export function campaignForceTotals(units, countryId) {
	const totals = {
		formations: 0,
		personnel: 0,
		roles: Object.fromEntries(ROLE_KEYS.map((key) => [key, 0])),
	};
	for (const unit of units || []) {
		if (
			unit.sovereignId !== Number(countryId) ||
			!(unit.health > 0) ||
			unit.kind === "transport"
		)
			continue;
		const personnel = getFormationPersonnel(unit);
		if (!(personnel > 0)) continue;
		totals.formations++;
		totals.personnel += personnel;
		totals.roles[
			ROLE_KEYS.includes(unit.campaignRole) ? unit.campaignRole : "infantry"
		]++;
	}
	return totals;
}

export function campaignDisplayedForces(runtime, country) {
	if (campaignPanelState(runtime).editable)
		return campaignForceTotals(runtime.units, country.id);
	return (
		runtime.campaign?.finalForces?.[country.id] || {
			formations: country.formations,
			personnel: country.deployed,
			roles: country.roleCounts || {},
		}
	);
}

export function campaignEventCategory(type) {
	if (
		["city_captured", "capital_captured", "region_control_changed"].includes(
			type,
		)
	)
		return "territory";
	if (
		["country_capitulated", "dependency_changed", "peace_signed"].includes(type)
	)
		return "diplomacy";
	if (
		type?.startsWith("building_") ||
		type?.startsWith("production_") ||
		["shortage", "policy", "order_cancelled"].includes(type)
	)
		return "economy";
	return "forces";
}

export function selectCampaignEvents(
	events,
	{ countryId = null, category = "all", limit = 100 } = {},
) {
	if (!(limit > 0)) return [];
	return (events || [])
		.filter((event) => {
			const matchesCountry =
				countryId === null ||
				event.type === "peace_signed" ||
				[
					event.countryId,
					event.previousCountryId,
					event.controllerId,
					event.overlordId,
					event.targetCountryId,
				].some((id) => Number(id) === Number(countryId));
			return (
				matchesCountry &&
				(category === "all" || campaignEventCategory(event.type) === category)
			);
		})
		.slice(-Math.min(100, Math.max(0, limit)))
		.reverse();
}

export function formatCampaignEvent(event, runtime, translate = gameText) {
	const city = Object.values(runtime.campaign?.countries || {})
		.flatMap((country) => country.cities || [])
		.find((entry) => String(entry.id) === String(event.cityId));
	const role = ROLE_KEYS.includes(event.role) ? event.role : "infantry";
	const equipment = EQUIPMENT_KEYS.includes(event.equipment)
		? event.equipment
		: "armor";
	const mission = MISSION_KEYS.includes(event.mission)
		? event.mission
		: "aircraft";
	return translate(
		`CAMPAIGN_EVENT_${EVENT_TYPES.has(event.type) ? event.type : "unknown"}`,
		{
			country: countryName(runtime, event.countryId, translate),
			previous: countryName(runtime, event.previousCountryId, translate),
			target: countryName(runtime, event.targetCountryId, translate),
			controller:
				event.overlordId || event.controllerId
					? countryName(
							runtime,
							event.overlordId || event.controllerId,
							translate,
						)
					: translate(
							event.type === "region_control_changed"
								? "CAMPAIGN_SOURCE_UNKNOWN"
								: "CAMPAIGN_INDEPENDENT",
						),
			city: event.cityName || city?.name || translate("CAMPAIGN_UNKNOWN_CITY"),
			role: translate(`CAMPAIGN_ROLE_${role}`),
			equipment: translate(`CAMPAIGN_EQUIPMENT_${equipment}`),
			building: translate(
				`CAMPAIGN_BUILDING_${BUILDING_KEYS.includes(event.building) ? event.building : "economy"}`,
			),
			mission: translate(`CAMPAIGN_MISSION_${mission}`),
			mobilization: translate(
				`CAMPAIGN_MOBILIZATION_${[0, 1, 2].includes(event.level) ? event.level : 0}`,
			),
			policy: translate(
				`CAMPAIGN_POLICY_${POLICY_KEYS.includes(event.policy) ? event.policy : "balanced"}`,
			),
			region:
				event.regionNames?.[getLanguage()] ||
				event.regionNames?.en ||
				event.regionId ||
				translate("CAMPAIGN_SOURCE_UNKNOWN"),
			control: translate(
				`CAMPAIGN_CONTROL_${["full", "majority", "contested"].includes(event.control) ? event.control : "contested"}`,
			),
			share: number(Math.max(0, Math.min(1, event.share || 0)) * 100),
			shortage: translate(
				event.reason === "supplies"
					? "CAMPAIGN_SHORTAGE_supplies"
					: "CAMPAIGN_SHORTAGE_funds",
			),
		},
	);
}

export function campaignOrderError(reason, translate = gameText) {
	const aliases = {
		disabled: "inactive",
		inactive_game: "inactive",
		timeout: "connection",
		unavailable: "connection",
		invalid_country: "country",
		invalid_command: "invalid",
		invalid_role: "invalid",
		invalid_quantity: "invalid",
		queue_full: "queue",
		no_city: "city",
		formation_cap: "cap",
		manpower: "reserve",
		invalid_building: "invalid",
		max_level: "level",
		invalid_equipment: "invalid",
		invalid_mission: "invalid",
		invalid_target: "target",
		mission_busy: "cooldown",
		no_formation: "formation",
		invalid_level: "invalid",
		invalid_policy: "invalid",
		invalid_order: "invalid",
		supplies: "supplies",
		bombs_disabled: "bombs_disabled",
	};
	const code =
		aliases[reason] ||
		(["funds", "equipment", "connection", "inactive", "country"].includes(
			reason,
		)
			? reason
			: "unknown");
	return translate("CAMPAIGN_ERROR", {
		reason: translate(`CAMPAIGN_ERROR_${code}`),
	});
}

/** All scenario-provided text is rendered as text nodes, including journal entries. */
export function installCampaignUI(
	runtime,
	{ documentRef = document, windowRef = window } = {},
) {
	const create = (tag, className = "", text = undefined) => {
		const node = documentRef.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	};
	const localized = (tag, key, className = "") => {
		const node = create(tag, className, gameText(key));
		node.dataset.campaignI18n = key;
		return node;
	};
	const button = (key, id, className = "campaign-button") => {
		const node = localized("button", key, className);
		node.type = "button";
		node.id = `campaign-${id}`;
		return node;
	};
	const select = (id) => {
		const node = create("select");
		node.id = `campaign-${id}`;
		return node;
	};
	const setOptions = (node, values, label) => {
		const signature = JSON.stringify(
			values.map((value) => [String(value), label(value)]),
		);
		if (node.dataset.options === signature) return;
		const previous = node.value;
		node.replaceChildren(
			...values.map((value) => {
				const option = create("option", "", label(value));
				option.value = String(value);
				return option;
			}),
		);
		if (values.some((value) => String(value) === previous))
			node.value = previous;
		node.dataset.options = signature;
	};
	const field = (labelKey, control) => {
		const label = localized("label", labelKey);
		label.htmlFor = control.id;
		const wrapper = create("div", "campaign-field");
		wrapper.append(label, control);
		return wrapper;
	};
	const paragraph = (parent, key) => {
		const node = localized("p", key, "campaign-note");
		parent.append(node);
		return node;
	};
	const card = (parent, key) => {
		const node = create("section", "campaign-card");
		node.append(localized("h3", key));
		parent.append(node);
		return node;
	};
	const entry = button(
		"CAMPAIGN_TITLE",
		"hud-button",
		"mini-btn hud-action campaign-hud-button",
	);
	entry.hidden = true;
	entry.setAttribute("aria-haspopup", "dialog");
	const host = documentRef.querySelector(".hud-menu-content");
	if (!host) return { refresh() {}, open() {}, close() {}, destroy() {} };
	host.append(entry);
	const panel = create("dialog", "campaign-panel");
	panel.id = "campaign-panel";
	panel.setAttribute("aria-labelledby", "campaign-title");
	const header = create("header", "campaign-header");
	const title = localized("h2", "CAMPAIGN_TITLE");
	title.id = "campaign-title";
	const closeButton = button("CAMPAIGN_CLOSE", "close");
	header.append(title, closeButton);
	panel.append(header);
	const introduction = paragraph(panel, "CAMPAIGN_INTRO");
	const toolbar = create("div", "campaign-toolbar");
	const countrySelect = select("country");
	const period = create("p", "campaign-period");
	toolbar.append(field("CAMPAIGN_COUNTRY", countrySelect), period);
	panel.append(toolbar);
	paragraph(panel, "CAMPAIGN_CYCLE_NOTE");
	const status = create("p", "campaign-status");
	status.id = "campaign-status";
	status.setAttribute("role", "status");
	status.setAttribute("aria-live", "polite");
	panel.append(status);
	const tabs = create("div", "campaign-tabs");
	tabs.setAttribute("role", "tablist");
	const views = {};
	const tabButtons = {};
	let currentTab = "overview";
	for (const [id, key] of [
		["overview", "CAMPAIGN_OVERVIEW"],
		["management", "CAMPAIGN_MANAGEMENT"],
		["operations", "CAMPAIGN_OPERATIONS"],
		["journal", "CAMPAIGN_JOURNAL"],
	]) {
		const tab = button(key, `tab-${id}`, "campaign-tab");
		tab.setAttribute("role", "tab");
		tab.setAttribute("aria-controls", `campaign-view-${id}`);
		tabButtons[id] = tab;
		tabs.append(tab);
		const view = create("section", "campaign-view");
		view.id = `campaign-view-${id}`;
		view.setAttribute("role", "tabpanel");
		view.setAttribute("aria-labelledby", tab.id);
		views[id] = view;
		tab.addEventListener("click", () => {
			currentTab = id;
			render();
		});
		tab.addEventListener("keydown", (event) => {
			const ids = Object.keys(views);
			const movement =
				event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
			if (!movement) return;
			event.preventDefault();
			currentTab = ids[(ids.indexOf(id) + movement + ids.length) % ids.length];
			render();
			tabButtons[currentTab].focus();
		});
	}
	panel.append(tabs, ...Object.values(views));
	paragraph(views.overview, "CAMPAIGN_FICTIONAL");
	const metrics = create("dl", "campaign-metrics");
	const metricNodes = {};
	for (const [id, key] of Object.entries({
		treasury: "CAMPAIGN_TREASURY",
		income: "CAMPAIGN_INCOME",
		upkeep: "CAMPAIGN_UPKEEP",
		formations: "CAMPAIGN_FORMATIONS",
		deployed: "CAMPAIGN_DEPLOYED",
		reserve: "CAMPAIGN_RESERVE",
		supplies: "CAMPAIGN_SUPPLIES",
	})) {
		const wrapper = create("div");
		const value = create("dd");
		value.id = `campaign-metric-${id}`;
		metricNodes[id] = value;
		wrapper.append(localized("dt", key), value);
		metrics.append(wrapper);
	}
	views.overview.append(metrics);
	const forcesNote = paragraph(views.overview, "CAMPAIGN_FORCES_NOTE");
	const forces = card(views.overview, "CAMPAIGN_ROLE");
	const roleList = create("dl", "campaign-stock-list");
	forces.append(roleList);
	const stock = card(views.overview, "CAMPAIGN_STOCK");
	paragraph(stock, "CAMPAIGN_STOCK_NOTE");
	const stockList = create("dl", "campaign-stock-list");
	stock.append(stockList);
	const relations = card(views.overview, "CAMPAIGN_RELATIONSHIP");
	const relationList = create("div");
	relations.append(relationList);
	const sources = create("details", "campaign-card campaign-sources");
	sources.append(localized("summary", "CAMPAIGN_SOURCE_TITLE"));
	paragraph(sources, "CAMPAIGN_SOURCE_NOTE");
	const sourceList = create("dl", "campaign-source-list");
	sources.append(sourceList);
	views.overview.append(sources);
	const managementGrid = create("div", "campaign-card-grid");
	views.management.append(managementGrid);
	const training = card(managementGrid, "CAMPAIGN_TRAINING");
	const trainingRole = select("training-role");
	const trainingQuantity = select("training-quantity");
	const trainingNote = create("p", "campaign-note");
	const trainingCost = create("p", "campaign-cost");
	const trainingStock = create("p", "campaign-note");
	const train = button("CAMPAIGN_TRAIN", "train");
	const demobilize = button(
		"CAMPAIGN_DEMOBILIZE",
		"demobilize",
		"campaign-button campaign-button-secondary",
	);
	training.append(
		field("CAMPAIGN_ROLE", trainingRole),
		trainingNote,
		field("CAMPAIGN_QUANTITY", trainingQuantity),
		trainingCost,
		trainingStock,
		train,
		demobilize,
	);
	paragraph(training, "CAMPAIGN_DEMOBILIZE_NOTE");
	const construction = card(managementGrid, "CAMPAIGN_CITY_BUILD");
	const citySelect = select("city");
	const buildingSelect = select("building");
	const cityLevels = create("p", "campaign-note");
	const buildingNote = create("p", "campaign-note");
	const buildingCost = create("p", "campaign-cost");
	const build = button("CAMPAIGN_BUILD", "build");
	construction.append(
		field("CAMPAIGN_CITY", citySelect),
		cityLevels,
		field("CAMPAIGN_BUILDING", buildingSelect),
		buildingNote,
		buildingCost,
		build,
	);
	const production = card(managementGrid, "CAMPAIGN_PRODUCTION");
	const equipmentSelect = select("equipment");
	const equipmentQuantity = select("equipment-quantity");
	const productionCost = create("p", "campaign-cost");
	const produce = button("CAMPAIGN_PRODUCE", "produce");
	production.append(
		field("CAMPAIGN_EQUIPMENT", equipmentSelect),
		field("CAMPAIGN_QUANTITY", equipmentQuantity),
		productionCost,
		produce,
	);
	const mobilization = card(managementGrid, "CAMPAIGN_MOBILIZATION");
	paragraph(mobilization, "CAMPAIGN_MOBILIZATION_NOTE");
	paragraph(mobilization, "CAMPAIGN_MOBILIZATION_COST");
	const mobilizationSelect = select("mobilization");
	const civilian = create("p", "campaign-note");
	const mobilize = button("CAMPAIGN_APPLY", "mobilize");
	mobilization.append(
		field("CAMPAIGN_MOBILIZATION", mobilizationSelect),
		civilian,
		mobilize,
	);
	const strategy = card(managementGrid, "CAMPAIGN_AI");
	paragraph(strategy, "CAMPAIGN_POLICY_NOTE");
	const policySelect = select("policy");
	const automation = create("input");
	automation.type = "checkbox";
	automation.id = "campaign-automation";
	const automationLabel = localized("label", "CAMPAIGN_AUTOMATION");
	automationLabel.htmlFor = automation.id;
	const automationRow = create("div", "campaign-checkbox");
	automationRow.append(automation, automationLabel);
	const policy = button("CAMPAIGN_APPLY", "apply-policy");
	strategy.append(
		field("CAMPAIGN_POLICY", policySelect),
		automationRow,
		policy,
	);
	const queue = card(views.management, "CAMPAIGN_QUEUE");
	paragraph(queue, "CAMPAIGN_QUEUE_NOTE");
	const queueList = create("ul", "campaign-order-list");
	queueList.id = "campaign-queue";
	queue.append(queueList);
	paragraph(views.operations, "CAMPAIGN_MISSION_NOTE");
	const operation = card(views.operations, "CAMPAIGN_MISSION");
	const missionSelect = select("mission");
	const targetSelect = select("target");
	const missionCost = create("p", "campaign-cost");
	const missionStock = create("p", "campaign-note");
	const launch = button("CAMPAIGN_LAUNCH", "launch");
	operation.append(
		field("CAMPAIGN_MISSION", missionSelect),
		field("CAMPAIGN_TARGET", targetSelect),
		missionCost,
		missionStock,
		launch,
	);
	const active = card(views.operations, "CAMPAIGN_MISSIONS_ACTIVE");
	const activeList = create("ul", "campaign-order-list");
	active.append(activeList);
	const journalToolbar = create("div", "campaign-toolbar");
	const scopeSelect = select("event-country");
	const categorySelect = select("event-category");
	const notifications = create("input");
	notifications.id = "campaign-notifications";
	notifications.type = "checkbox";
	try {
		notifications.checked =
			windowRef.localStorage.getItem(NOTIFICATIONS_KEY) !== "false";
	} catch {
		notifications.checked = true;
	}
	const notificationsLabel = localized("label", "CAMPAIGN_NOTIFY");
	notificationsLabel.htmlFor = notifications.id;
	const notificationsRow = create("div", "campaign-checkbox");
	notificationsRow.append(notifications, notificationsLabel);
	journalToolbar.append(
		field("CAMPAIGN_FILTER_COUNTRY", scopeSelect),
		field("CAMPAIGN_FILTER_TYPE", categorySelect),
	);
	views.journal.append(journalToolbar, notificationsRow);
	paragraph(views.journal, "CAMPAIGN_JOURNAL_NOTE");
	const journalList = create("ol", "campaign-event-list");
	journalList.id = "campaign-events";
	views.journal.append(journalList);
	const toast = create("div", "campaign-toast");
	toast.hidden = true;
	toast.setAttribute("role", "status");
	toast.setAttribute("aria-live", "polite");
	documentRef.body.append(panel, toast);
	const commandButtons = [
		train,
		demobilize,
		build,
		produce,
		mobilize,
		policy,
		launch,
	];
	let pending = false;
	let destroyed = false;
	let editedPolicy = false;
	let editedMobilization = false;
	let selectedCountryId = null;
	let lastEventId = null;
	let lastPeriod = -1;
	let lastToastAt = 0;
	let statusKey = "";
	let statusReason = "";
	let sourceSignature = "";
	let relationSignature = "";
	const available = () => campaignPanelState(runtime).visible;
	const currentCountry = () =>
		runtime.campaign?.countries?.[countrySelect.value];
	const sourceLink = (parent, observation) => {
		if (!observation?.sourceUrl) return;
		try {
			const url = new URL(observation.sourceUrl);
			if (!["https:", "http:"].includes(url.protocol)) return;
			const link = localized("a", "CAMPAIGN_SOURCE_LINK");
			link.href = url.href;
			link.target = "_blank";
			link.rel = "noopener noreferrer";
			parent.append(link);
		} catch {}
	};
	const renderRelations = (country) => {
		relationList.replaceChildren();
		const metadata = runtime.countryMetadata?.find(
			(item) => item?.id === country.id,
		);
		const legal = country.relationship || country.profile?.relationship;
		const relationship = legal?.legal || (legal?.type ? legal : null);
		const rows = [];
		if (
			relationship &&
			["self_governing_realm", "overseas_territory"].includes(relationship.type)
		)
			rows.push(relationship);
		if (metadata?.overlordId)
			rows.push({ type: "game_vassal", controllerId: metadata.overlordId });
		else if (!metadata && legal?.game) rows.push(legal.game);
		if (!rows.length) paragraph(relationList, "CAMPAIGN_RELATIONSHIP_NONE");
		for (const relation of rows) {
			const controller = relation.controllerId
				? countryName(runtime, relation.controllerId)
				: relation.controllerIso3 || gameText("CAMPAIGN_SOURCE_UNKNOWN");
			const text = create(
				"p",
				"campaign-note",
				gameText(`CAMPAIGN_RELATION_${relation.type}`, { controller }),
			);
			if (relation.asOf)
				text.append(
					create(
						"span",
						"campaign-source-date",
						gameText("CAMPAIGN_SOURCE_ASOF", { date: relation.asOf }),
					),
				);
			sourceLink(text, relation);
			relationList.append(text);
		}
	};
	const renderSources = (country) => {
		sourceList.replaceChildren();
		const profile = country.profile;
		for (const [key, observation] of [
			["personnel", profile?.personnel],
			...OBSERVATION_KEYS.map((key) => [key, profile?.equipment?.[key]]),
		]) {
			const row = create("div");
			const value = create("dd");
			value.append(
				create(
					"strong",
					"",
					observation?.value != null &&
						Number.isFinite(Number(observation.value))
						? number(observation.value)
						: gameText("CAMPAIGN_SOURCE_UNKNOWN"),
				),
			);
			if (observation?.value != null) {
				if (observation.asOf)
					value.append(
						create(
							"span",
							"campaign-source-date",
							gameText("CAMPAIGN_SOURCE_ASOF", { date: observation.asOf }),
						),
					);
				if (observation.sourceDate)
					value.append(
						create(
							"span",
							"campaign-source-date",
							gameText("CAMPAIGN_SOURCE_PUBLISHED", {
								date: observation.sourceDate,
							}),
						),
					);
				if (observation.license)
					value.append(
						create("span", "campaign-source-date", observation.license),
					);
				sourceLink(value, observation);
			}
			row.append(localized("dt", `CAMPAIGN_SOURCE_${key}`), value);
			sourceList.append(row);
		}
	};
	const fillList = (node, entries) => {
		node.replaceChildren(
			...entries.map(([label, value]) => {
				const row = create("div");
				row.append(create("dt", "", label), create("dd", "", number(value)));
				return row;
			}),
		);
	};
	const queueRows = new Map();
	const renderOrders = (country) => {
		const orders = (country.queue || []).slice(0, 12);
		const retained = new Set(
			orders.map((order) => `${country.id}:${order.id}`),
		);
		for (const [id, row] of queueRows) {
			if (retained.has(id)) continue;
			row.item.remove();
			queueRows.delete(id);
		}
		if (!queueRows.size) queueList.replaceChildren();
		for (const order of orders) {
			const key =
				order.type === "train"
					? `CAMPAIGN_ROLE_${order.role}`
					: order.type === "build"
						? `CAMPAIGN_BUILDING_${order.building}`
						: `CAMPAIGN_EQUIPMENT_${order.equipment}`;
			const city = country.cities?.find(
				(entry) => String(entry.id) === String(order.cityId),
			);
			const rowId = `${country.id}:${order.id}`;
			let row = queueRows.get(rowId);
			if (!row) {
				const item = create("li");
				const title = create("strong");
				const remaining = create("span", "campaign-note");
				const cancel = button(
					"CAMPAIGN_CANCEL_ORDER",
					`cancel-${order.id}`,
					"campaign-button campaign-button-secondary campaign-order-cancel",
				);
				const orderId = order.id;
				cancel.addEventListener(
					"click",
					() => void send({ action: "cancel", orderId }),
				);
				item.append(title, remaining, cancel);
				queueList.append(item);
				row = { item, title, remaining, cancel };
				queueRows.set(rowId, row);
			}
			// Preserve the focused cancel button while simulation totals refresh.
			row.title.textContent = `${gameText(key)}${order.quantity > 1 ? ` × ${number(order.quantity)}` : ""}${city ? ` · ${city.name}` : ""}`;
			row.remaining.textContent = gameText("CAMPAIGN_REMAINING", {
				count: number(order.remainingPeriods),
			});
			row.cancel.disabled =
				pending ||
				!campaignPanelState(runtime).editable ||
				!campaignOrdersReady(runtime);
		}
		if (!queueList.children.length)
			queueList.append(
				localized("li", "CAMPAIGN_QUEUE_EMPTY", "campaign-note"),
			);
		activeList.replaceChildren();
		for (const mission of country.missions || []) {
			const item = create("li");
			item.append(
				create(
					"strong",
					"",
					`${gameText(`CAMPAIGN_MISSION_${mission.mission}`)} · ${countryName(runtime, mission.targetCountryId)}`,
				),
				create(
					"span",
					"campaign-note",
					gameText("CAMPAIGN_REMAINING", {
						count: number(mission.remainingPeriods),
					}),
				),
			);
			activeList.append(item);
		}
		if (!activeList.children.length)
			activeList.append(
				localized("li", "CAMPAIGN_MISSIONS_EMPTY", "campaign-note"),
			);
	};
	const filteredEvents = () =>
		selectCampaignEvents(runtime.campaign?.events, {
			countryId:
				scopeSelect.value === "selected" ? Number(countrySelect.value) : null,
			category: categorySelect.value || "all",
		});
	const renderJournal = () => {
		journalList.replaceChildren();
		for (const event of filteredEvents()) {
			const item = create("li");
			item.append(
				create(
					"span",
					"campaign-event-time",
					gameText("CAMPAIGN_EVENT_TIME", {
						count: number(
							Math.floor(
								(event.tick || 0) / (runtime.campaign?.periodTicks || 120),
							),
						),
					}),
				),
				create("span", "", formatCampaignEvent(event, runtime)),
			);
			journalList.append(item);
		}
		if (!journalList.children.length)
			journalList.append(
				localized("li", "CAMPAIGN_JOURNAL_EMPTY", "campaign-note"),
			);
	};
	const updateNotifications = () => {
		const nextEventId = runtime.campaign?.nextEventId || 1;
		const currentPeriod = runtime.campaign?.period || 0;
		if (
			!available() ||
			!notifications.checked ||
			documentRef.visibilityState === "hidden"
		)
			toast.hidden = true;
		if (
			lastEventId !== null &&
			nextEventId >= lastEventId &&
			currentPeriod >= lastPeriod &&
			available() &&
			notifications.checked &&
			!panel.open &&
			documentRef.visibilityState !== "hidden"
		) {
			const event = filteredEvents().find((item) => item.id >= lastEventId);
			if (event) {
				toast.textContent = formatCampaignEvent(event, runtime);
				toast.hidden = false;
				lastToastAt = Date.now();
			}
		}
		if (Date.now() - lastToastAt > 6000) toast.hidden = true;
		lastEventId = available() ? nextEventId : null;
		lastPeriod = currentPeriod;
	};
	const render = () => {
		if (destroyed) return;
		entry.hidden = !available();
		if (!available()) {
			if (panel.open) panel.close();
			toast.hidden = true;
			lastEventId = null;
			return;
		}
		if (!panel.open) return;
		const readOnly = !campaignPanelState(runtime).editable;
		const ownerReady = campaignOrdersReady(runtime);
		introduction.dataset.campaignI18n = readOnly
			? "CAMPAIGN_FINISHED_INTRO"
			: "CAMPAIGN_INTRO";
		forcesNote.dataset.campaignI18n = readOnly
			? "CAMPAIGN_FINISHED_FORCES_NOTE"
			: "CAMPAIGN_FORCES_NOTE";
		for (const node of panel.querySelectorAll("[data-campaign-i18n]"))
			node.textContent = gameText(node.dataset.campaignI18n);
		entry.textContent = gameText("CAMPAIGN_TITLE");
		const countries = Object.values(runtime.campaign.countries || {}).filter(
			(country) =>
				readOnly ||
				!runtime.sides ||
				runtime.sides[country.sideIndex]?.some(
					(member) =>
						(typeof member === "object" ? member.id : member) === country.id,
				),
		);
		setOptions(
			countrySelect,
			countries.map((country) => country.id),
			(id) => countryName(runtime, id),
		);
		setOptions(trainingRole, ROLE_KEYS, (key) =>
			gameText(`CAMPAIGN_ROLE_${key}`),
		);
		setOptions(
			trainingQuantity,
			Array.from({ length: 10 }, (_, i) => i + 1),
			String,
		);
		setOptions(buildingSelect, BUILDING_KEYS, (key) =>
			gameText(`CAMPAIGN_BUILDING_${key}`),
		);
		setOptions(equipmentSelect, EQUIPMENT_KEYS, (key) =>
			gameText(`CAMPAIGN_EQUIPMENT_${key}`),
		);
		setOptions(
			equipmentQuantity,
			Array.from({ length: 10 }, (_, i) => i + 1),
			String,
		);
		setOptions(mobilizationSelect, [0, 1, 2], (key) =>
			gameText(`CAMPAIGN_MOBILIZATION_${key}`),
		);
		setOptions(policySelect, POLICY_KEYS, (key) =>
			gameText(`CAMPAIGN_POLICY_${key}`),
		);
		setOptions(missionSelect, MISSION_KEYS, (key) =>
			gameText(`CAMPAIGN_MISSION_${key}`),
		);
		setOptions(scopeSelect, ["all", "selected"], (key) =>
			gameText(`CAMPAIGN_FILTER_${key.toUpperCase()}`),
		);
		setOptions(
			categorySelect,
			["all", "territory", "forces", "economy", "diplomacy"],
			(key) => gameText(`CAMPAIGN_CATEGORY_${key}`),
		);
		const country = currentCountry();
		const changedCountry = selectedCountryId !== country?.id;
		if (changedCountry) {
			selectedCountryId = country?.id;
			editedPolicy = false;
			editedMobilization = false;
		}
		period.textContent = gameText("CAMPAIGN_PERIOD", {
			count: number(runtime.campaign.period),
		});
		status.textContent = !country
			? gameText("CAMPAIGN_NO_COUNTRY")
			: readOnly
				? gameText("CAMPAIGN_FINISHED")
				: !ownerReady
					? gameText("CAMPAIGN_CONNECTION_WAIT")
					: statusReason
						? campaignOrderError(statusReason)
						: statusKey
							? gameText(statusKey)
							: "";
		status.classList.toggle(
			"campaign-status-error",
			!readOnly && Boolean(statusReason),
		);
		for (const [id, view] of Object.entries(views)) {
			view.hidden = currentTab !== id;
			tabButtons[id].setAttribute("aria-selected", String(currentTab === id));
			tabButtons[id].tabIndex = currentTab === id ? 0 : -1;
		}
		for (const node of commandButtons)
			node.disabled = pending || !country || readOnly || !ownerReady;
		countrySelect.disabled = pending;
		for (const control of [
			trainingRole,
			trainingQuantity,
			citySelect,
			buildingSelect,
			equipmentSelect,
			equipmentQuantity,
			mobilizationSelect,
			policySelect,
			automation,
			missionSelect,
			targetSelect,
		]) {
			control.disabled = pending || !country || readOnly || !ownerReady;
		}
		if (currentTab === "journal") renderJournal();
		if (!country) return;
		const controlledCities = (country.cities || []).filter(
			(city) => Number(city.controllerId) === country.id,
		);
		setOptions(
			citySelect,
			controlledCities.length ? controlledCities.map((city) => city.id) : [""],
			(id) =>
				controlledCities.find((city) => city.id === id)?.name ||
				gameText("CAMPAIGN_CITY_NONE"),
		);
		const opponents = countries.filter(
			(entry) =>
				entry.id !== country.id && entry.sideIndex !== country.sideIndex,
		);
		setOptions(
			targetSelect,
			opponents.length ? opponents.map((entry) => entry.id) : [""],
			(id) =>
				id ? countryName(runtime, id) : gameText("CAMPAIGN_TARGET_NONE"),
		);
		build.disabled ||= !controlledCities.length;
		launch.disabled ||= !opponents.length;
		if (!editedMobilization)
			mobilizationSelect.value = String(country.mobilization);
		if (!editedPolicy) {
			policySelect.value = country.policy;
			automation.checked = Boolean(country.automation);
		}
		if (currentTab === "overview") {
			const totals = campaignDisplayedForces(runtime, country);
			for (const [key, node] of Object.entries(metricNodes))
				node.textContent = number(
					key === "deployed"
						? totals.personnel
						: key === "formations"
							? totals.formations
							: country[key],
				);
			fillList(
				roleList,
				ROLE_KEYS.map((key) => [
					gameText(`CAMPAIGN_ROLE_${key}`),
					totals.roles[key],
				]),
			);
			fillList(
				stockList,
				EQUIPMENT_KEYS.map((key) => [
					gameText(`CAMPAIGN_EQUIPMENT_${key}`),
					country.equipment?.[key],
				]),
			);
			const nextRelation = JSON.stringify([
				country.id,
				country.relationship,
				runtime.countryMetadata?.find((item) => item?.id === country.id)
					?.overlordId,
				getLanguage(),
			]);
			if (nextRelation !== relationSignature) {
				renderRelations(country);
				relationSignature = nextRelation;
			}
			const nextSource = JSON.stringify([
				country.id,
				country.profile,
				getLanguage(),
			]);
			if (nextSource !== sourceSignature) {
				renderSources(country);
				sourceSignature = nextSource;
			}
		}
		if (currentTab === "management") {
			const definition = CAMPAIGN_ROLES[trainingRole.value];
			const quantity = Number(trainingQuantity.value) || 1;
			trainingNote.textContent = gameText(
				`CAMPAIGN_ROLE_NOTE_${trainingRole.value}`,
			);
			trainingCost.textContent = gameText("CAMPAIGN_TRAIN_COST", {
				cost: number(definition.cost * quantity),
				personnel: number(definition.personnel * quantity),
				duration: number(definition.duration),
			});
			trainingStock.textContent = Object.keys(definition.equipment).length
				? gameText("CAMPAIGN_REQUIRES", {
						stock: Object.entries(definition.equipment)
							.map(
								([key, amount]) =>
									`${gameText(`CAMPAIGN_EQUIPMENT_${key}`)} × ${number(amount * quantity)}`,
							)
							.join(", "),
					})
				: "";
			const city = controlledCities.find(
				(entry) => String(entry.id) === citySelect.value,
			);
			cityLevels.textContent = city
				? BUILDING_KEYS.map((key) =>
						gameText("CAMPAIGN_LEVEL", {
							building: gameText(`CAMPAIGN_BUILDING_${key}`),
							level: number(city.buildings?.[key]),
						}),
					).join(" · ")
				: "";
			const building = CAMPAIGN_BUILDINGS[buildingSelect.value];
			buildingNote.textContent = gameText(
				`CAMPAIGN_BUILDING_NOTE_${buildingSelect.value}`,
			);
			const queuedLevels = (country.queue || []).filter(
				(order) =>
					order.type === "build" &&
					String(order.cityId) === citySelect.value &&
					order.building === buildingSelect.value,
			).length;
			buildingCost.textContent = gameText("CAMPAIGN_COST", {
				cost: number(
					building.cost *
						(1 + (city?.buildings?.[buildingSelect.value] || 0) + queuedLevels),
				),
				duration: number(building.duration),
			});
			const equipment = CAMPAIGN_EQUIPMENT[equipmentSelect.value];
			const productionQuantity = Number(equipmentQuantity.value) || 1;
			productionCost.textContent = gameText("CAMPAIGN_COST", {
				cost: number(equipment.cost * productionQuantity),
				duration: number(
					equipment.duration + Math.floor((productionQuantity - 1) / 3),
				),
			});
			civilian.textContent = gameText("CAMPAIGN_CIVILIAN", {
				count: number(country.civilianPool),
			});
			renderOrders(country);
		}
		if (currentTab === "operations") {
			const mission = CAMPAIGN_MISSIONS[missionSelect.value];
			missionCost.textContent = gameText("CAMPAIGN_COST", {
				cost: number(mission.cost),
				duration: number(mission.duration),
			});
			missionStock.textContent = gameText("CAMPAIGN_MISSION_STOCK", {
				stock: gameText(`CAMPAIGN_EQUIPMENT_${missionSelect.value}`),
				count: number(country.equipment?.[missionSelect.value]),
				supplies: number(mission.supplies),
				available: number(country.supplies),
			});
			renderOrders(country);
		}
	};
	const send = async (command) => {
		if (pending || destroyed) return;
		const country = currentCountry();
		if (!campaignPanelState(runtime).editable || !country) return;
		if (!campaignOrdersReady(runtime)) {
			render();
			return;
		}
		pending = true;
		statusKey = "CAMPAIGN_PENDING";
		statusReason = "";
		render();
		try {
			const result = await runtime.simulationClient.command({
				type: "campaign",
				countryId: country.id,
				...command,
			});
			statusKey = result?.ok ? "CAMPAIGN_ACCEPTED" : "";
			statusReason = result?.ok ? "" : result?.reason || "unknown";
			if (result?.ok && command.action === "policy") editedPolicy = false;
			if (result?.ok && command.action === "mobilize")
				editedMobilization = false;
		} catch {
			statusKey = "";
			statusReason = "connection";
		} finally {
			pending = false;
			render();
		}
	};
	train.addEventListener(
		"click",
		() =>
			void send({
				action: "train",
				role: trainingRole.value,
				quantity: Number(trainingQuantity.value),
			}),
	);
	demobilize.addEventListener(
		"click",
		() => void send({ action: "demobilize", role: trainingRole.value }),
	);
	build.addEventListener(
		"click",
		() =>
			void send({
				action: "build",
				cityId: citySelect.value,
				building: buildingSelect.value,
			}),
	);
	produce.addEventListener(
		"click",
		() =>
			void send({
				action: "production",
				equipment: equipmentSelect.value,
				quantity: Number(equipmentQuantity.value),
			}),
	);
	mobilize.addEventListener(
		"click",
		() =>
			void send({
				action: "mobilize",
				level: Number(mobilizationSelect.value),
			}),
	);
	policy.addEventListener(
		"click",
		() =>
			void send({
				action: "policy",
				policy: policySelect.value,
				automation: automation.checked,
			}),
	);
	launch.addEventListener(
		"click",
		() =>
			void send({
				action: "mission",
				mission: missionSelect.value,
				targetCountryId: Number(targetSelect.value),
			}),
	);
	for (const node of [
		countrySelect,
		trainingRole,
		trainingQuantity,
		citySelect,
		buildingSelect,
		equipmentSelect,
		equipmentQuantity,
		missionSelect,
		targetSelect,
		scopeSelect,
		categorySelect,
	])
		node.addEventListener("change", render);
	policySelect.addEventListener("change", () => {
		editedPolicy = true;
	});
	automation.addEventListener("change", () => {
		editedPolicy = true;
	});
	mobilizationSelect.addEventListener("change", () => {
		editedMobilization = true;
	});
	notifications.addEventListener("change", () => {
		try {
			windowRef.localStorage.setItem(
				NOTIFICATIONS_KEY,
				String(notifications.checked),
			);
		} catch {}
		if (!notifications.checked) toast.hidden = true;
	});
	const open = () => {
		if (!available() || destroyed) return;
		const menu = documentRef.getElementById("hud-menu");
		if (menu) menu.open = false;
		if (!panel.open) panel.showModal();
		toast.hidden = true;
		render();
		countrySelect.focus();
	};
	const close = () => {
		if (panel.open) panel.close();
	};
	entry.addEventListener("click", open);
	closeButton.addEventListener("click", close);
	// Global map hotkeys must not consume typing, Space or Escape inside the dialog.
	const blockGameKeys = (event) => {
		if (!panel.open || event.ctrlKey || event.metaKey) return;
		event.stopImmediatePropagation();
		if (event.key === "Escape") {
			event.preventDefault();
			if (event.type === "keydown") close();
		}
	};
	panel.addEventListener("keydown", blockGameKeys);
	panel.addEventListener("keyup", blockGameKeys);
	const refresh = () => {
		render();
		updateNotifications();
	};
	const languageChanged = () => {
		entry.textContent = gameText("CAMPAIGN_TITLE");
		render();
	};
	documentRef.addEventListener("languagechange", languageChanged);
	const timer = windowRef.setInterval(refresh, 1000);
	const destroy = () => {
		if (destroyed) return;
		destroyed = true;
		windowRef.clearInterval(timer);
		documentRef.removeEventListener("languagechange", languageChanged);
		panel.removeEventListener("keydown", blockGameKeys);
		panel.removeEventListener("keyup", blockGameKeys);
		windowRef.removeEventListener("pagehide", destroy);
		panel.remove();
		entry.remove();
		toast.remove();
	};
	windowRef.addEventListener("pagehide", destroy, { once: true });
	refresh();
	return { refresh, open, close, destroy };
}
