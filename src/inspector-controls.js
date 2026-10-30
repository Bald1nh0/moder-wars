import { showAlert, showConfirm } from "./dialogs.js";
import { gameText } from "./i18n.js";
// Controls receive live state and commands; they do not import the application.
export function createInspectorControls(runtime) {
	async function loadReferenceGeometry() {
		try {
			runtime.loadingStatus.innerText = gameText(
				"EDITOR_MSG_REFERENCE_LOADING",
			);
			runtime.loadingOverlay.style.display = "flex";
			return await runtime.ensureRawGeography();
		} catch (error) {
			console.warn("Modern reference geography unavailable:", error);
			showAlert(gameText("EDITOR_MSG_REFERENCE_FAILED"));
			return null;
		} finally {
			runtime.loadingOverlay.style.display = "none";
		}
	}

	function bindConfirmCreateBtnClick() {
		runtime.confirmCreateBtn.addEventListener("click", async () => {
			const name = runtime.newCountryNameInput.value || gameText("NEW_NATION");
			const color = runtime.newCountryColorInput.value;
			const file = runtime.newCountryFlagInput.files[0];

			runtime.customCountryData = {
				name,
				color: `${color.replace("#", "rgba(")})`, // basic hex to rgba converter simplified
				flagUrl: null,
			};

			// Correct hex to rgba
			const r = parseInt(color.slice(1, 3), 16);
			const g = parseInt(color.slice(3, 5), 16);
			const b = parseInt(color.slice(5, 7), 16);
			runtime.customCountryData.color = `rgba(${r}, ${g}, ${b}, 0.5)`;
			runtime.customCountryData.displayName = name;

			if (file) {
				try {
					runtime.loadingStatus.innerText = gameText(
						"EDITOR_MSG_FLAG_UPLOADING",
					);
					runtime.loadingOverlay.style.display = "flex";
					runtime.customCountryData.flagUrl = await websim.upload(file);
					runtime.loadingOverlay.style.display = "none";
				} catch (e) {
					console.error("Flag upload failed", e);
				}
			}

			runtime.createCountryModal.style.display = "none";
			runtime.gameState = "EDITOR_PLACING";
			runtime.statusText.innerText = gameText("EDITOR_MSG_PLACE_CAPITAL");
			runtime.map.getContainer().classList.add("painting-cursor");
		});
	}

	function bindInspectNameInputInput() {
		runtime.inspectNameInput.addEventListener("input", (e) => {
			if (runtime.editingCountryId <= 0) return;
			const meta = runtime.countryMetadata[runtime.editingCountryId - 1];
			if (meta) {
				meta.name = e.target.value;
				// Propagate to live setup/simulation objects
				runtime.sides.flat().forEach((c) => {
					if (c.id === runtime.editingCountryId) c.name = meta.name;
				});
				runtime.updateSidesUI();
				// Ensure labels recalculate their spine/position in real-time
				runtime.recalculateAllBounds();
				runtime.influenceLayer.render();
			}
		});
	}

	function bindInspectHubFlagBtnClick() {
		runtime.inspectHubFlagBtn.addEventListener("click", () => {
			runtime.openHub("flags");
		});
	}

	function bindInspectFetchFlagBtnClick() {
		runtime.inspectFetchFlagBtn.addEventListener("click", async () => {
			if (runtime.editingCountryId <= 0) return;
			const enteredName = runtime.inspectNameInput.value.trim();
			if (!enteredName) return;
			const meta = runtime.countryMetadata?.[runtime.editingCountryId - 1];
			const name = enteredName === meta?.displayName ? meta.name : enteredName;

			let code = runtime.findCodeByName(name);

			// Fallback to GeoJSON search if code mapping doesn't have it
			if (!code) {
				const reference =
					runtime.rawGeoJsonData || (await loadReferenceGeometry());
				if (!reference) return;
				const feature = reference.features.find((f) => {
					const p = f.properties;
					const possibleNames = [
						p.NAME,
						p.name,
						p.admin,
						p.NAME_LONG,
						p.formal_en,
						p.name_sort,
					]
						.filter(Boolean)
						.map((n) => n.toLowerCase());
					return possibleNames.includes(name.toLowerCase());
				});

				if (feature) {
					const getFeatCode = (feat) => {
						if (!feat?.properties) return null;
						const p = feat.properties;
						let c =
							p.ISO_A2 || p.iso_a2 || p.ISO_A2_EH || p.iso_a2_eh || p.ADDR_A2;
						if (c === "-99") c = null;
						return c ? c.toLowerCase() : null;
					};
					code = getFeatCode(feature);
				}
			}

			if (!code) {
				showAlert(gameText("EDITOR_MSG_FLAG_NOT_FOUND", { name }));
				return;
			}

			const flagUrl = `https://flagcdn.com/w160/${code}.webp`;
			runtime.updateCountryFlag(runtime.editingCountryId, flagUrl);
		});
	}

	function bindInspectFlagInputChange() {
		runtime.inspectFlagInput.addEventListener("change", async (e) => {
			const file = e.target.files[0];
			if (file && runtime.editingCountryId > 0) {
				try {
					runtime.loadingStatus.innerText = gameText(
						"EDITOR_MSG_FLAG_UPLOADING",
					);
					runtime.loadingOverlay.style.display = "flex";
					const url = await websim.upload(file);

					runtime.updateCountryFlag(runtime.editingCountryId, url);
					runtime.loadingOverlay.style.display = "none";
				} catch (err) {
					console.error(err);
					runtime.loadingOverlay.style.display = "none";
				}
			}
		});
	}

	function bindInspectColorPickerInput() {
		runtime.inspectColorPicker.addEventListener("input", (e) => {
			if (runtime.editingCountryId <= 0) return;
			const newColorHex = e.target.value;
			const r = parseInt(newColorHex.slice(1, 3), 16);
			const g = parseInt(newColorHex.slice(3, 5), 16);
			const b = parseInt(newColorHex.slice(5, 7), 16);

			const meta = runtime.countryMetadata[runtime.editingCountryId - 1];
			if (meta) {
				meta.color = `rgba(${r}, ${g}, ${b}, 0.5)`;
				meta.rgba = [r, g, b, 0.5];
				runtime.inspectColorSwatch.style.backgroundColor = meta.color;
				runtime.influenceLayer.render();
			}
		});
	}

	function bindInspectPaintBtnClick() {
		runtime.inspectPaintBtn.addEventListener("click", () => {
			runtime.gameState = "EDITOR_PAINTING";
			runtime.statusText.innerText = gameText("EDITOR_MSG_PAINT_BORDERS");
			runtime.countryInspector.style.display = "none";
			runtime.map.getContainer().classList.add("painting-cursor");
			runtime.editorPaintBtn.style.display = "block";
			runtime.editorFillBtn.style.display = "block";
			runtime.editorUnclaimBtn.style.display = "block";
			runtime.editorPaintBtn.classList.add("active");
			runtime.brushControls.style.display = "flex";
		});
	}

	function bindInspectAnnexClickBtnClick() {
		runtime.inspectAnnexClickBtn.addEventListener("click", () => {
			if (runtime.editingCountryId <= 0) return;
			runtime.gameState = "EDITOR_ANNEXING";
			runtime.statusText.innerText = gameText("EDITOR_MSG_ANNEX_TOOL");
			runtime.countryInspector.style.display = "none";
			runtime.map.getContainer().classList.add("painting-cursor");
		});
	}

	function bindAnnexCountryBtnClick() {
		runtime.annexCountryBtn.addEventListener("click", async () => {
			if (runtime.editingCountryId <= 0) return;
			const name = runtime.annexCountryInput.value.trim().toLowerCase();
			if (!name) return;

			const reference =
				runtime.rawGeoJsonData || (await loadReferenceGeometry());
			if (!reference) return;
			const feature = reference.features.find((f) => {
				const fName = (
					f.properties.NAME ||
					f.properties.name ||
					f.properties.admin ||
					f.properties.NAME_LONG ||
					""
				).toLowerCase();
				return fName === name;
			});

			if (!feature) {
				showAlert(gameText("EDITOR_MSG_COUNTRY_NOT_FOUND"));
				return;
			}

			await runtime.annexFeatureToCountry(feature, runtime.editingCountryId);
			runtime.annexCountryInput.value = "";
		});
	}

	function bindAddAllyBtnClick() {
		if (runtime.addAllyBtn) {
			runtime.addAllyBtn.addEventListener("click", () => {
				if (runtime.editingCountryId <= 0) {
					showAlert(gameText("EDITOR_MSG_SELECT_ALLY_SOURCE"));
					return;
				}
				runtime.selectingAllyForId = runtime.editingCountryId;
				runtime.gameState = "EDITOR_SELECTING_ALLY";
				runtime.statusText.innerText = gameText("EDITOR_MSG_SELECT_ALLY");
				runtime.countryInspector.style.display = "none";
				runtime.map.getContainer().classList.add("painting-cursor");
			});
		}
	}

	function bindClearAlliesBtnClick() {
		if (runtime.clearAlliesBtn) {
			runtime.clearAlliesBtn.addEventListener("click", () => {
				if (runtime.editingCountryId <= 0) return;
				const meta = runtime.countryMetadata[runtime.editingCountryId - 1];
				if (!meta?.allies || meta.allies.length === 0) return;
				const allies = [...meta.allies];
				allies.forEach((aid) => {
					const aMeta = runtime.countryMetadata[aid - 1];
					if (aMeta && Array.isArray(aMeta.allies)) {
						aMeta.allies = aMeta.allies.filter(
							(id) => id !== runtime.editingCountryId,
						);
					}
				});
				meta.allies = [];
				runtime.markAllianceCacheDirty();
				runtime.statusText.innerText = gameText("EDITOR_MSG_ALLIES_CLEARED");
				runtime.openInspector(runtime.editingCountryId);
				runtime.influenceLayer.render();
			});
		}
	}

	function bindAllianceFlagInputChange() {
		if (runtime.allianceFlagInput) {
			runtime.allianceFlagInput.addEventListener("change", async (e) => {
				const file = e.target.files[0];
				if (!file || runtime.editingCountryId <= 0) return;
				try {
					runtime.loadingStatus.innerText = gameText(
						"EDITOR_MSG_ALLIANCE_FLAG_UPLOADING",
					);
					runtime.loadingOverlay.style.display = "flex";
					const url = await websim.upload(file);
					const rootId = runtime.getAllianceRootId(runtime.editingCountryId);
					if (!rootId) {
						runtime.loadingOverlay.style.display = "none";
						showAlert(gameText("EDITOR_MSG_ALLIANCE_NOT_FOUND"));
						return;
					}
					const rootMeta = runtime.countryMetadata[rootId - 1];
					if (!rootMeta) {
						runtime.loadingOverlay.style.display = "none";
						showAlert(gameText("EDITOR_MSG_ALLIANCE_METADATA_MISSING"));
						return;
					}
					rootMeta.allianceFlagUrl = url;
					rootMeta.allianceFlagTempFlag = new Image();
					rootMeta.allianceFlagTempFlag.crossOrigin = "anonymous";
					rootMeta.allianceFlagTempFlag.onload = () => {
						runtime.loadingOverlay.style.display = "none";
						runtime.influenceLayer.render();
					};
					rootMeta.allianceFlagTempFlag.src = url;
					runtime.statusText.innerText = gameText(
						"EDITOR_MSG_ALLIANCE_FLAG_SET",
					);
				} catch (err) {
					console.error("Alliance flag upload failed", err);
					runtime.loadingOverlay.style.display = "none";
					showAlert(gameText("EDITOR_MSG_ALLIANCE_FLAG_FAILED"));
				}
			});
		}
	}

	function bindClearOverlordBtnClick() {
		document.getElementById("clear-overlord-btn").onclick = () => {
			if (runtime.editingCountryId <= 0) return;
			const meta = runtime.countryMetadata[runtime.editingCountryId - 1];
			if (meta) {
				meta.overlordId = null;
				runtime.sides.flat().forEach((c) => {
					if (c.id === runtime.editingCountryId) c.overlordId = null;
				});

				// If this country had an original flag before puppetization, restore it
				if (meta.baseFlagUrl) {
					runtime.updateCountryFlag(runtime.editingCountryId, meta.baseFlagUrl);
				}

				runtime.statusText.innerText = gameText("EDITOR_MSG_VASSAL_CLEARED", {
					name: meta.displayName || meta.name,
				});
				runtime.openInspector(runtime.editingCountryId);
				runtime.influenceLayer.render();
			}
		};
	}

	function bindCloseInspectorBtnClick() {
		runtime.closeInspectorBtn.addEventListener("click", () => {
			runtime.countryInspector.style.display = "none";
			runtime.editingCountryId = -1;
			runtime.influenceLayer.render();
		});
	}

	function bindInspectBuffBtnClick() {
		if (runtime.inspectBuffBtn) {
			runtime.inspectBuffBtn.addEventListener("click", (event) => {
				if (runtime.editingCountryId <= 0) return;
				const meta = runtime.countryMetadata[runtime.editingCountryId - 1];
				if (!meta) return;

				// Determine direction: clicked arrow uses its data-dir, clicking center cycles forward
				let dir = 1;
				const target = event.target;
				if (target?.classList.contains("buff-arrow")) {
					const d = parseInt(target.getAttribute("data-dir"), 10);
					if (d === -1 || d === 1) dir = d;
				}

				// ALT-click: adjust hidden (invisible) buff that overrides visible buff during play
				if (event.altKey) {
					const currentHidden = meta.hiddenBuffState || "none";
					const nextHidden = runtime.cycleBuffState(currentHidden, dir);
					meta.hiddenBuffState = nextHidden;

					// Propagate hidden buff to any live side objects
					runtime.sides.flat().forEach((c) => {
						if (c && c.id === runtime.editingCountryId) {
							c.hiddenBuffState = nextHidden;
						}
					});

					runtime.statusText.innerText = gameText("EDITOR_MSG_SECRET_BUFF", {
						name: meta.displayName || meta.name,
						buff: runtime.BUFF_METADATA[nextHidden]?.label || nextHidden,
					});
					runtime.influenceLayer.render();
					return;
				}

				// Normal click: adjust visible buff (what the player can see in UI)
				const current = meta.buffState || "none";
				const nextState = runtime.cycleBuffState(current, dir);
				meta.buffState = nextState;

				// Propagate visible buff to any live side objects so setup UI matches
				runtime.sides.flat().forEach((c) => {
					if (c && c.id === runtime.editingCountryId) {
						c.buffState = nextState;
					}
				});

				const bMeta =
					runtime.BUFF_METADATA[nextState] || runtime.BUFF_METADATA.none;
				runtime.inspectBuffBtn.innerHTML = `
            <span class="buff-arrow" data-dir="-1" style="font-size: 12px; margin-right:4px;">◀</span>
            <span class="buff-label">${gameText("EDITOR_MSG_BUFF", { buff: bMeta.label })}</span>
            <span class="buff-arrow" data-dir="1" style="font-size: 12px; margin-left:4px;">▶</span>
        `;
				runtime.inspectBuffBtn.style.background = bMeta.color;
				runtime.inspectBuffBtn.style.color = bMeta.textColor;

				// Refresh setup UI so side slots show the new visible buff
				runtime.updateSidesUI();
				runtime.influenceLayer.render();
			});
		}
	}

	function bindCityNameInputInput() {
		runtime.cityNameInput.addEventListener("input", (e) => {
			if (runtime.editingCityId <= 0) return;
			const city = runtime.cities.find((c) => c.id === runtime.editingCityId);
			if (!city) return;
			city.name = e.target.value;
			runtime.influenceLayer.render();
		});
	}

	function bindCityOwnerSelectChange() {
		runtime.cityOwnerSelect.addEventListener("change", () => {
			if (runtime.editingCityId <= 0) return;
			const city = runtime.cities.find((c) => c.id === runtime.editingCityId);
			if (!city) return;
			const val = parseInt(runtime.cityOwnerSelect.value || "0", 10);
			city.ownerId = val;
			city.sovereignId = city.ownerId;
			runtime.invalidateTerritoryLedgerCities();
			runtime.influenceLayer.render();
		});
	}

	function bindCityCapitalCheckboxChange() {
		runtime.cityCapitalCheckbox.addEventListener("change", () => {
			if (runtime.editingCityId <= 0) return;
			const city = runtime.cities.find((c) => c.id === runtime.editingCityId);
			if (!city) return;
			const ownerId = city.ownerId || city.sovereignId;
			city.isCapital = runtime.cityCapitalCheckbox.checked;
			if (ownerId && city.isCapital) {
				// Clear capital flag on other cities of this owner
				runtime.cities.forEach((c) => {
					if (c.id !== city.id && (c.ownerId || c.sovereignId) === ownerId) {
						c.isCapital = false;
					}
				});
			}
			runtime.invalidateTerritoryLedgerCities();
			runtime.influenceLayer.render();
		});
	}

	function bindCityMoveBtnClick() {
		runtime.cityMoveBtn.addEventListener("click", () => {
			if (runtime.editingCityId <= 0) return;
			runtime.statusText.innerText = gameText("EDITOR_MSG_MOVE_CITY");
			runtime.cityEditMode = "MOVE";
			runtime.cityInspector.style.display = "none";
		});
	}

	function bindCityDeleteBtnClick() {
		runtime.cityDeleteBtn.addEventListener("click", async () => {
			if (runtime.editingCityId <= 0) return;
			const city = runtime.cities.find((c) => c.id === runtime.editingCityId);
			if (!city) return;
			if (
				!(await showConfirm(
					gameText("EDITOR_MSG_DELETE_CITY_CONFIRM", { name: city.name }),
					{
						title: gameText("EDITOR_MSG_DELETE_CITY"),
						okLabel: gameText("EDITOR_MSG_DELETE"),
						danger: true,
					},
				))
			)
				return;
			runtime.cities = runtime.cities.filter((c) => c.id !== city.id);
			runtime.activeTheaterCities = runtime.activeTheaterCities.filter(
				(c) => c.id !== city.id,
			);
			runtime.invalidateTerritoryLedgerCities();
			runtime.editingCityId = -1;
			runtime.cityInspector.style.display = "none";
			runtime.influenceLayer.render();
			runtime.statusText.innerText = gameText("EDITOR_MSG_CITY_DELETED");
		});
	}

	function bindCityCloseBtnClick() {
		runtime.cityCloseBtn.addEventListener("click", () => {
			runtime.cityInspector.style.display = "none";
			runtime.editingCityId = -1;
		});
	}

	function bindEditorCityNewBtnClick() {
		if (runtime.editorCityNewBtn) {
			runtime.editorCityNewBtn.addEventListener("click", () => {
				if (!(runtime.gameMode === "EDITOR" || runtime.godModeActive)) return;
				runtime.cityEditMode = "CREATE";
				runtime.statusText.innerText = gameText("EDITOR_MSG_CREATE_CITY");
				runtime.cityInspector.style.display = "none";
			});
		}
	}

	function bindEditorCityClearBtnClick() {
		if (runtime.editorCityClearBtn) {
			runtime.editorCityClearBtn.addEventListener("click", async () => {
				if (!(runtime.gameMode === "EDITOR" || runtime.godModeActive)) return;

				// Robust multi-stage verification for critical deletion
				const verify1 = await showConfirm(
					gameText("EDITOR_MSG_CLEAR_CITIES_CONFIRM"),
					{
						title: gameText("EDITOR_MSG_CLEAR_CITIES"),
						okLabel: gameText("EDITOR_MSG_PROCEED"),
						danger: true,
					},
				);
				if (!verify1) return;

				const verify2 = await showConfirm(
					gameText("EDITOR_MSG_CLEAR_CITIES_FINAL"),
					{
						title: gameText("EDITOR_MSG_FINAL_CONFIRM"),
						okLabel: gameText("EDITOR_MSG_REMOVE_ALL"),
						danger: true,
					},
				);
				if (!verify2) return;
				if (!(runtime.gameMode === "EDITOR" || runtime.godModeActive)) return;

				runtime.cities = [];
				runtime.activeTheaterCities = [];
				runtime.invalidateTerritoryLedgerCities();
				runtime.editingCityId = -1;
				runtime.cityInspector.style.display = "none";
				runtime.influenceLayer.render();
				runtime.statusText.innerText = gameText("EDITOR_MSG_CITIES_CLEARED");
				runtime.playClickSound();
			});
		}
	}
	return {
		bindConfirmCreateBtnClick,
		bindInspectNameInputInput,
		bindInspectHubFlagBtnClick,
		bindInspectFetchFlagBtnClick,
		bindInspectFlagInputChange,
		bindInspectColorPickerInput,
		bindInspectPaintBtnClick,
		bindInspectAnnexClickBtnClick,
		bindAnnexCountryBtnClick,
		bindAddAllyBtnClick,
		bindClearAlliesBtnClick,
		bindAllianceFlagInputChange,
		bindClearOverlordBtnClick,
		bindCloseInspectorBtnClick,
		bindInspectBuffBtnClick,
		bindCityNameInputInput,
		bindCityOwnerSelectChange,
		bindCityCapitalCheckboxChange,
		bindCityMoveBtnClick,
		bindCityDeleteBtnClick,
		bindCityCloseBtnClick,
		bindEditorCityNewBtnClick,
		bindEditorCityClearBtnClick,
	};
}
