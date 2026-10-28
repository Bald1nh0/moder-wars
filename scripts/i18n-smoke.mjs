import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import {
	applyLanguage,
	configureLanguageUi,
	gameText,
	getLanguage,
	getTranslation,
	TRANSLATIONS,
} from "../src/i18n.js";

const english = TRANSLATIONS.en;
const placeholders = (text) =>
	[...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1]).sort();
for (const lang of ["uk", "ru"]) {
	for (const [key, value] of Object.entries(english)) {
		assert.ok(
			Object.hasOwn(TRANSLATIONS[lang], key),
			`${lang}: missing ${key}`,
		);
		if (typeof value === "string") {
			assert.equal(typeof TRANSLATIONS[lang][key], "string");
			assert.ok(TRANSLATIONS[lang][key].trim(), `${lang}: empty ${key}`);
			assert.deepEqual(
				placeholders(TRANSLATIONS[lang][key]),
				placeholders(value),
				`${lang}: placeholders ${key}`,
			);
		}
	}
	for (const name of Object.keys(english.NATIONS))
		assert.ok(
			TRANSLATIONS[lang].NATIONS[name],
			`${lang}: missing nation ${name}`,
		);
}
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
for (const [, key] of html.matchAll(
	/data-i18n(?:-(?:title|placeholder|aria-label))?="([^"]+)"/g,
))
	assert.equal(typeof english[key], "string", `unresolved HTML key ${key}`);
for (const filename of readdirSync(new URL("../src/", import.meta.url))) {
	if (!filename.endsWith(".js") || filename.startsWith("translations"))
		continue;
	const source = readFileSync(
		new URL(`../src/${filename}`, import.meta.url),
		"utf8",
	);
	for (const [, key] of source.matchAll(/\bgameText\("([^"]+)"/g))
		assert.equal(
			typeof english[key],
			"string",
			`${filename}: unresolved ${key}`,
		);
}

assert.doesNotMatch(html, /<[^>]*data-i18n="[^"]+"[^>]*id="status-text"/);
assert.doesNotMatch(html, /<[^>]*id="status-text"[^>]*data-i18n="/);

const previousDocument = globalThis.document;
const cookieValues = new Map();
const element = (attributes) => ({
	attributes: new Map(Object.entries(attributes)),
	innerText: "",
	value: "",
	getAttribute(name) {
		return this.attributes.get(name);
	},
	setAttribute(name, value) {
		this.attributes.set(name, value);
	},
});
const text = element({ "data-i18n": "LANGUAGE" });
const title = element({ "data-i18n-title": "HIDE_UNITS" });
const placeholder = element({ "data-i18n-placeholder": "SELECT_P1" });
const accessible = element({ "data-i18n-aria-label": "START_WAR" });
const selector = element({});
const root = element({});
const country = { name: "Ukraine" },
	custom = { name: "My Custom Nation" };
const status = { innerText: english.SIM_PAUSED };
const seenLanguages = [];
try {
	globalThis.document = {
		documentElement: root,
		get cookie() {
			return [...cookieValues]
				.map(([key, value]) => `${key}=${value}`)
				.join("; ");
		},
		set cookie(value) {
			const [key, encoded] = value.split(";")[0].split("=");
			cookieValues.set(key, encoded);
		},
		getElementById: (id) => (id === "language-select" ? selector : null),
		querySelectorAll: (query) =>
			({
				"[data-i18n]": [text],
				"[data-i18n-title]": [title],
				"[data-i18n-placeholder]": [placeholder],
				"[data-i18n-aria-label]": [accessible],
			})[query] || [],
	};
	configureLanguageUi({
		statusText: () => status,
		countryMetadata: () => [country, custom],
		refreshDynamic: () => seenLanguages.push(getLanguage()),
	});
	for (const lang of ["uk", "ru", "en", "uk"]) {
		applyLanguage(lang);
		assert.equal(selector.value, lang);
		assert.equal(root.getAttribute("lang"), lang);
		assert.equal(text.innerText, TRANSLATIONS[lang].LANGUAGE);
		assert.equal(title.getAttribute("title"), TRANSLATIONS[lang].HIDE_UNITS);
		assert.equal(
			placeholder.getAttribute("placeholder"),
			TRANSLATIONS[lang].SELECT_P1,
		);
		assert.equal(
			accessible.getAttribute("aria-label"),
			TRANSLATIONS[lang].START_WAR,
		);
		assert.equal(status.innerText, TRANSLATIONS[lang].SIM_PAUSED);
		assert.equal(
			country.displayName,
			getTranslation("Ukraine", lang, "NATIONS"),
		);
		assert.equal(country.name, "Ukraine");
		assert.equal(custom.displayName, custom.name);
		assert.equal(
			seenLanguages.at(-1),
			lang,
			"dynamic UI observes new language",
		);
	}
	status.innerText = getTranslation("APP_28", "uk", null, {
		p0: "Custom Scenario: A & B",
	});
	applyLanguage("ru");
	assert.equal(
		status.innerText,
		getTranslation("APP_28", "ru", null, { p0: "Custom Scenario: A & B" }),
	);
	applyLanguage("uk");
	selector.value = "en";
	applyLanguage();
	assert.equal(
		selector.value,
		"uk",
		"restore saved language without explicit selection",
	);
	const paramKey = Object.keys(english).find(
		(key) => typeof english[key] === "string" && english[key].includes("{p0}"),
	);
	assert.ok(paramKey);
	const inserted = "<player $& {untouched}>";
	assert.ok(
		gameText(paramKey, { p0: inserted }).includes(inserted),
		"parameters remain text, never replacement syntax",
	);
	applyLanguage("not-a-language");
	assert.equal(getLanguage(), "en");
	assert.equal(selector.value, "en");
} finally {
	globalThis.document = previousDocument;
	configureLanguageUi({});
}
assert.equal(
	getLanguage(),
	"en",
	"translation imports work outside the browser",
);
console.log(
	"Russian/Ukrainian dictionary, placeholders, HTML keys, attributes, language switching and cookie restoration passed",
);
