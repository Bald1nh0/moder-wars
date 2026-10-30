import { getCookie, setCookie } from "./preferences.js";
import { TRANSLATIONS } from "./translations.js";

export { TRANSLATIONS };

let hooks = {};
const ATTRIBUTES = ["title", "placeholder", "aria-label"];
export function configureLanguageUi(callbacks) {
	hooks = callbacks;
}

export function getLanguage() {
	const saved =
		typeof document !== "undefined" && typeof document.cookie === "string"
			? getCookie("mw_lang")
			: "en";
	return Object.hasOwn(TRANSLATIONS, saved) ? saved : "en";
}

function translateStatus(text, previous, lang) {
	const source = Object.entries(TRANSLATIONS[previous]).filter(
		([, value]) => typeof value === "string",
	);
	const exact = source.find(([, value]) => value === text);
	if (exact) return getTranslation(exact[0], lang);
	// Only the status label is reverse-matched. User-authored DOM content is
	// never scanned or translated. Prefer the most specific message template.
	const templates = source.filter(([, value]) => /\{\w+\}/.test(value));
	templates.sort(
		(a, b) =>
			b[1].replace(/\{\w+\}/g, "").length - a[1].replace(/\{\w+\}/g, "").length,
	);
	for (const [key, value] of templates) {
		const names = [];
		let pattern = "",
			end = 0;
		const escapePattern = (part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		for (const match of value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)) {
			pattern += `${escapePattern(value.slice(end, match.index))}([\\s\\S]*?)`;
			names.push(match[1]);
			end = match.index + match[0].length;
		}
		const match = new RegExp(
			`^${pattern}${escapePattern(value.slice(end))}$`,
		).exec(text);
		if (match)
			return getTranslation(
				key,
				lang,
				null,
				Object.fromEntries(names.map((name, i) => [name, match[i + 1]])),
			);
	}
	return text;
}

export function applyLanguage(language = getLanguage()) {
	const lang = Object.hasOwn(TRANSLATIONS, language) ? language : "en";
	const previous = getLanguage();
	// Dynamic refresh callbacks must see the newly selected language.
	setCookie("mw_lang", lang);
	document.documentElement?.setAttribute("lang", lang);
	document.querySelectorAll("[data-i18n]").forEach((el) => {
		const key = el.getAttribute("data-i18n");
		if (TRANSLATIONS[lang][key] || TRANSLATIONS.en[key])
			el.innerText = getTranslation(key, lang);
	});
	for (const attribute of ATTRIBUTES) {
		document.querySelectorAll(`[data-i18n-${attribute}]`).forEach((el) => {
			const key = el.getAttribute(`data-i18n-${attribute}`);
			if (TRANSLATIONS[lang][key] || TRANSLATIONS.en[key])
				el.setAttribute(attribute, getTranslation(key, lang));
		});
	}

	// Existing status text may have been rendered in any previously selected language.
	const status = hooks.statusText?.();
	if (status)
		status.innerText = translateStatus(status.innerText, previous, lang);
	for (const id of ["treaty-msg", "treaty-status"]) {
		const message = document.getElementById(id);
		if (message)
			message.innerText = translateStatus(message.innerText, previous, lang);
	}
	const select = document.getElementById("language-select");
	if (select) select.value = lang;
	for (const country of hooks.countryMetadata?.() || []) {
		if (country?.name)
			country.displayName = getTranslation(country.name, lang, "NATIONS");
	}
	hooks.refreshSides?.();
	hooks.refreshDynamic?.();
	if (typeof CustomEvent !== "undefined")
		document.dispatchEvent?.(
			new CustomEvent("languagechange", { detail: { language: lang } }),
		);
}

export function getTranslation(
	key,
	lang = getLanguage(),
	subDict = null,
	params = {},
) {
	const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
	const value = subDict
		? dict[subDict]?.[key] || TRANSLATIONS.en[subDict]?.[key] || key
		: dict[key] || TRANSLATIONS.en[key] || key;
	if (typeof value !== "string") return key;
	return value.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, name) =>
		Object.hasOwn(params, name) ? String(params[name]) : placeholder,
	);
}

export function gameText(key, params = {}) {
	return getTranslation(key, undefined, null, params);
}
