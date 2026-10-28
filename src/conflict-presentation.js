import { gameText, getTranslation } from "./i18n.js";
/** Browser presentation for domain events; the simulation never reads the DOM. */
export function createConflictPresentation(runtime) {
	function presentCapitulation(country) {
		runtime.statusText.innerText = gameText("GAME_CAPITULATED", {
			name: getTranslation(country.name, undefined, "NATIONS"),
		});
		runtime.treatyMsg.innerText = gameText("GAME_NATION_ANNEXED");
		document.getElementById("treaty-status").innerText = gameText(
			"GAME_TERRITORY_SEIZED",
			{ name: getTranslation(country.name, undefined, "NATIONS") },
		);
		runtime.treatyAlert.style.display = "block";
		runtime.simulationClient?.syncControls();
		runtime.scheduleWarLifecycleCallback(() => {
			const state = runtime.gameState;
			if (state !== "SIMULATING" && !state?.startsWith("PEACE_SELECT_")) return;
			runtime.treatyAlert.style.display = "none";
			// The simulation holds peace proposals while a notice is visible.
			runtime.simulationClient?.syncControls();
		}, 4000);
	}
	function presentTreatyStart() {
		runtime.playPeaceSound();

		// Stop recording if active
		if (runtime.mediaRecorder && runtime.mediaRecorder.state !== "inactive") {
			runtime.mediaRecorder.onstop = () => {
				const blob = new Blob(runtime.recordedChunks, { type: "video/webm" });
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = `ModernWars_${Date.now()}.webm`;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				window.URL.revokeObjectURL(url);
				runtime.recordedChunks = [];
			};
			runtime.mediaRecorder.stop();
		}

		// Freeze time system at war end and reflect final date in the setup inputs
		if (
			runtime.gameTimeDate &&
			runtime.timeYearInput &&
			runtime.timeMonthInput &&
			runtime.timeDayInput
		) {
			runtime.gameTimeEnabled = false;
			runtime.gameTimeAccumulatorMs = 0;
			runtime.timeYearInput.value = runtime.gameTimeDate.year;
			runtime.timeMonthInput.value = runtime.gameTimeDate.month;
			runtime.timeDayInput.value = runtime.gameTimeDate.day;
			if (runtime.gameDateDisplay) {
				runtime.gameDateDisplay.textContent = runtime.formatGameDate();
				runtime.gameDateDisplay.style.display = "block";
			}
		}
	}
	function presentTreatyNotice({
		winnerName,
		loserNames,
		isTotalCapitulation,
		isNegotiatedPeace,
	}) {
		runtime.casualtyPanel.style.display = "none";
		if (isTotalCapitulation) {
			runtime.statusText.innerText = gameText("GAME_VICTORY", {
				winner: winnerName,
				losers: loserNames
					? gameText("GAME_DEFEATED", { names: loserNames })
					: "",
			});
			runtime.treatyMsg.innerText = gameText("GAME_TOTAL_ANNEXATION");
			document.getElementById("treaty-status").innerText = gameText(
				"GAME_CONFLICT_ENDED",
			);
			runtime.treatyAlert.style.display = "block";
		} else if (isNegotiatedPeace) {
			runtime.statusText.innerText = gameText("GAME_TREATY_SIGNED");
			runtime.treatyMsg.innerText = gameText("GAME_BORDERS_REDRAWN");
			document.getElementById("treaty-status").innerText = gameText(
				"GAME_TERRITORY_FINAL",
			);
			runtime.treatyAlert.style.display = "block";
		} else {
			runtime.statusText.innerText = gameText("GAME_WHITE_PEACE_SIGNED");
		}
	}
	function onConflictMapChanged() {
		runtime.recalculateAllBounds();
		runtime.updateSidesUI();
		runtime.influenceLayer?.render();
	}
	function presentTreatyFinished() {
		runtime.animationFrameId = null;
		runtime.stopWarAmbiance();
		runtime.treatyAlert.style.display = "none";
		runtime.updateWarOverview(true);
		runtime.scheduleWarLifecycleCallback(
			runtime.reopenConflictSetupAfterWar,
			1500,
		);
	}
	return {
		presentCapitulation,
		presentTreatyStart,
		presentTreatyNotice,
		onConflictMapChanged,
		presentTreatyFinished,
	};
}
