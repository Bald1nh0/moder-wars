import {
	createSimulationModePreference,
	simulationGameUrl,
} from "./feature-flags.js";
import { gameText } from "./i18n.js";

/** A fresh tab applies the preference without discarding the current game. */
export function installSimulationModeSettings(sessionMode) {
	const toggle = document.getElementById("server-simulation-enabled");
	const status = document.getElementById("simulation-mode-current");
	const link = document.getElementById("simulation-mode-open");
	const preference = createSimulationModePreference();
	const render = () => {
		toggle.checked = preference.mode === "server";
		status.textContent = gameText("SIMULATION_MODE_CURRENT", {
			mode: gameText(`SIMULATION_MODE_${sessionMode.toUpperCase()}`),
		});
		link.textContent = gameText("SIMULATION_MODE_OPEN", {
			mode: gameText(`SIMULATION_MODE_${preference.mode.toUpperCase()}`),
		});
		link.href = simulationGameUrl(location.href, preference.mode);
	};
	toggle.addEventListener("change", () => {
		preference.setServerEnabled(toggle.checked);
		render();
	});
	document.addEventListener("languagechange", render);
	render();
	return preference;
}
