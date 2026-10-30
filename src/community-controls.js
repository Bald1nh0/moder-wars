import { showAlert, showConfirm } from "./dialogs.js";
import { gameText } from "./i18n.js";
// Controls receive live state and commands; they do not import the application.
export function createCommunityControls(runtime) {
	function bindDeleteScenarioHandler() {
		window.deleteScenario = async (id) => {
			if (
				!(await showConfirm(gameText("APP_41"), {
					title: gameText("APP_42"),
					okLabel: gameText("APP_43"),
					danger: true,
				}))
			)
				return;
			try {
				await runtime.room.collection("scenario_v1").delete(id);
			} catch (e) {
				console.error(e);
				showAlert(gameText("APP_44"));
			}
		};
	}

	function bindDeleteFlagHandler() {
		window.deleteFlag = async (id) => {
			if (
				!(await showConfirm(gameText("APP_45"), {
					title: gameText("APP_46"),
					okLabel: gameText("COMMUNITY_REMOVE"),
					danger: true,
				}))
			)
				return;
			try {
				await runtime.room.collection("flag_library_v1").delete(id);
			} catch (e) {
				console.error(e);
				showAlert(gameText("APP_47"));
			}
		};
	}

	function bindImportFlagFromLibraryHandler() {
		window.importFlagFromLibrary = async (id) => {
			// Robust lookup to ensure we have the data
			const list = runtime.room.collection("flag_library_v1").getList();
			const flagData = list.find((f) => f.id === id);

			if (!flagData || runtime.editingCountryId <= 0) {
				if (runtime.editingCountryId <= 0) {
					showAlert(gameText("APP_48"));
				} else {
					showAlert(gameText("APP_49"));
				}
				return;
			}

			const meta = runtime.countryMetadata[runtime.editingCountryId - 1];
			if (meta) {
				runtime.updateCountryFlag(runtime.editingCountryId, flagData.flagUrl);
				runtime.closeHub();
				// Visual confirmation
				runtime.statusText.innerText = gameText("APP_50", {
					p0: meta.name,
					p1: flagData.name,
				});
			}
		};
	}

	function bindDeleteCountryHandler() {
		window.deleteCountry = async (id) => {
			if (
				!(await showConfirm(gameText("APP_51"), {
					title: gameText("APP_52"),
					okLabel: gameText("APP_43"),
					danger: true,
				}))
			)
				return;
			try {
				await runtime.room.collection("country_library_v1").delete(id);
			} catch (e) {
				console.error(e);
				showAlert(gameText("APP_53"));
			}
		};
	}

	function bindImportFromLibraryHandler() {
		window.importFromLibrary = async (id) => {
			const list = runtime.room.collection("country_library_v1").getList();
			const countryData = list.find((c) => c.id === id);
			if (!countryData) return;

			runtime.loadingStatus.innerText = gameText("APP_54", {
				p0: countryData.name,
			});
			runtime.loadingOverlay.style.display = "flex";
			runtime.closeHub();

			// Allow UI to update
			await new Promise((r) => setTimeout(r, 100));

			try {
				const newId = runtime.countryMetadata.length + 1;
				const newMeta = {
					id: newId,
					name: countryData.name,
					color: countryData.color,
					rgba: runtime.parseColorToRGBA(countryData.color),
					isCustom: true,
					flagUrl: countryData.flagUrl,
				};
				runtime.countryMetadata.push(newMeta);

				// Fetch cells from URL if they aren't in the record (new format to avoid 250KB limit)
				let cells = countryData.cells;
				if (!cells && countryData.cellsUrl) {
					try {
						const resp = await fetch(countryData.cellsUrl);
						cells = await resp.json();
					} catch (e) {
						console.error("Failed to fetch country cells", e);
						showAlert(gameText("APP_55"));
						runtime.loadingOverlay.style.display = "none";
						return;
					}
				}

				if (!cells) {
					showAlert(gameText("APP_56"));
					runtime.loadingOverlay.style.display = "none";
					return;
				}

				// Map relative cells to current grid
				const sourceRes = countryData.gridRes || runtime.CONFIG.GRID_RES;
				const targetRes = runtime.CONFIG.GRID_RES;

				cells.forEach(([cx, cy]) => {
					// Robust conversion: Fill all target cells that overlap with the source cell
					const baseLat = cy * sourceRes - 90;
					const baseLng = cx * sourceRes - 180;

					const xStart = Math.floor((baseLng + 180) / targetRes);
					const xEnd = Math.floor(
						(baseLng + sourceRes + 180 - 0.0001) / targetRes,
					);
					const yStart = Math.floor((baseLat + 90) / targetRes);
					const yEnd = Math.floor(
						(baseLat + sourceRes + 90 - 0.0001) / targetRes,
					);

					for (let ty = yStart; ty <= yEnd; ty++) {
						if (ty < 0 || ty >= runtime.gridHeight) continue;
						const rowOffset = ty * runtime.gridWidth;
						for (let tx = xStart; tx <= xEnd; tx++) {
							if (tx < 0 || tx >= runtime.gridWidth) continue;
							const tIdx = rowOffset + tx;
							runtime.worldControlMap[tIdx] = newId;
							if (runtime.landMask[tIdx] === 0) runtime.landMask[tIdx] = 1;
						}
					}
				});

				runtime.recalculateAllBounds();
				runtime.loadingOverlay.style.display = "none";
				runtime.influenceLayer.render();
				showAlert(gameText("APP_57", { p0: countryData.name }));
			} catch (e) {
				console.error(e);
				showAlert(gameText("APP_58"));
				runtime.loadingOverlay.style.display = "none";
			}
		};
	}

	function bindPlayFromHubHandler() {
		window.playFromHub = async (url, id, name, ownerUsername) => {
			runtime.primeAudio();
			runtime.setLoadingThematic(true);
			runtime.loadingStatus.innerText = gameText("APP_59");
			runtime.loadingOverlay.style.display = "flex";
			runtime.scenarioHubModal.style.display = "none";

			const currentUser = await window.websim.getCurrentUser();
			const myUsername = currentUser.username;

			try {
				const response = await fetch(url);
				if (!response.ok) throw new Error("Failed to fetch");
				const blob = await response.blob();

				runtime.currentScenarioContext = {
					id,
					name,
					ownerUsername,
					blobUrl: url,
				};
				runtime.activeScenarioId = ownerUsername === myUsername ? id : null;

				await runtime.performPresetLoad(blob, "CONQUEST");
				runtime.initAudio();

				if (runtime.activeScenarioId) {
					runtime.editorUpdateBtn.style.display = "block";
				} else {
					runtime.editorUpdateBtn.style.display = "none";
				}
			} catch (e) {
				console.error(e);
				showAlert(gameText("APP_60"));
				runtime.loadingOverlay.style.display = "none";
			}
		};
	}

	function bindRemixFromHubHandler() {
		window.remixFromHub = async (url, sourceId, sourceName, ownerUsername) => {
			runtime.primeAudio();
			runtime.setLoadingThematic(true);
			runtime.loadingStatus.innerText = gameText("APP_61");
			runtime.loadingOverlay.style.display = "flex";
			runtime.scenarioHubModal.style.display = "none";

			const currentUser = await window.websim.getCurrentUser();
			const myUsername = currentUser.username;

			try {
				const response = await fetch(url);
				if (!response.ok) throw new Error("Failed to fetch");
				const blob = await response.blob();
				await runtime.performPresetLoad(blob, "EDITOR");
				runtime.initAudio();

				runtime.currentScenarioContext = {
					id: sourceId,
					name: sourceName,
					ownerUsername,
					blobUrl: url,
				};
				runtime.statusText.innerText = gameText("APP_29", { p0: sourceName });

				// If we remix our OWN work, allow updating it
				runtime.activeScenarioId =
					ownerUsername === myUsername ? sourceId : null;
				if (runtime.activeScenarioId) {
					runtime.editorUpdateBtn.style.display = "block";
				} else {
					runtime.editorUpdateBtn.style.display = "none";
				}
			} catch (e) {
				console.error(e);
				showAlert(gameText("APP_62"));
				runtime.loadingOverlay.style.display = "none";
			}
		};
	}

	function bindGlobalChatCloseClick() {
		if (runtime.globalChatClose) {
			runtime.globalChatClose.addEventListener("click", () => {
				runtime.globalChatModal.style.display = "none";
			});
		}
	}

	function bindGlobalChatSendClick() {
		if (runtime.globalChatSend) {
			runtime.globalChatSend.addEventListener("click", async () => {
				if (!runtime.room || !runtime.globalChatInput) return;
				const text = runtime.globalChatInput.value.trim();
				if (!text) return;
				try {
					await runtime.room.collection("global_chat_v1").create({
						text,
					});
					runtime.globalChatInput.value = "";
				} catch (e) {
					console.error("Failed to send chat message", e);
				}
			});
		}
	}

	function bindGlobalChatInputKeydown() {
		if (runtime.globalChatInput) {
			runtime.globalChatInput.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !e.shiftKey) {
					e.preventDefault();
					if (runtime.globalChatSend) runtime.globalChatSend.click();
				}
			});
		}
	}

	function bindItemCommentSubmitClick() {
		runtime.itemCommentSubmit.addEventListener("click", async () => {
			if (!runtime.currentCommentItemType || !runtime.currentCommentItemId)
				return;
			const text = runtime.itemCommentInput.value.trim();
			if (!text) return;
			try {
				if (runtime.currentEditingCommentId) {
					// Edit existing comment
					await runtime.room
						.collection("hub_comment_v1")
						.update(runtime.currentEditingCommentId, {
							text,
						});
				} else {
					// New comment or reply
					await runtime.room.collection("hub_comment_v1").create({
						item_type: runtime.currentCommentItemType,
						item_id: runtime.currentCommentItemId,
						parent_id: runtime.currentReplyParentId,
						text,
					});
				}
				runtime.itemCommentInput.value = "";
				runtime.currentReplyParentId = null;
				runtime.currentEditingCommentId = null;
				runtime.itemReplyIndicator.style.display = "none";
				runtime.itemCancelReplyBtn.style.display = "none";
				runtime.itemCommentSubmit.setAttribute("data-i18n", "APP_63");
				runtime.itemCommentSubmit.textContent = gameText("APP_63");
			} catch (e) {
				console.error("Failed to post comment", e);
				showAlert(gameText("APP_64"));
			}
		});
	}

	function bindItemCancelReplyBtnClick() {
		runtime.itemCancelReplyBtn.addEventListener("click", () => {
			runtime.currentReplyParentId = null;
			runtime.currentEditingCommentId = null;
			runtime.itemReplyIndicator.style.display = "none";
			runtime.itemCancelReplyBtn.style.display = "none";
			runtime.itemCommentSubmit.setAttribute("data-i18n", "APP_63");
			runtime.itemCommentSubmit.textContent = gameText("APP_63");
		});
	}

	function bindCloseItemModalBtnClick() {
		runtime.closeItemModalBtn.addEventListener("click", () => {
			runtime.itemCommentModal.style.display = "none";
			if (runtime.commentsUnsubscribe) {
				runtime.commentsUnsubscribe();
				runtime.commentsUnsubscribe = null;
			}
		});
	}

	function bindCancelUploadBtnClick() {
		runtime.cancelUploadBtn.addEventListener("click", () => {
			runtime.uploadDetailsModal.style.display = "none";
		});
	}

	function bindConfirmUploadBtnClick() {
		runtime.confirmUploadBtn.addEventListener("click", async () => {
			const name =
				runtime.uploadNameInput.value.trim() ||
				gameText("COMMUNITY_UNTITLED_SCENARIO");
			const desc = runtime.uploadDescInput.value.trim();

			runtime.uploadDetailsModal.style.display = "none";
			runtime.loadingStatus.innerText = gameText("APP_65");
			runtime.loadingOverlay.style.display = "flex";

			try {
				// 1. Generate Preview Snapshot
				let previewUrl = null;
				if (runtime.influenceLayer?._container) {
					runtime.influenceLayer._isCapturing = true;
					runtime.influenceLayer.render();
					const canvas = runtime.influenceLayer._container;
					const previewBlob = await new Promise((resolve) =>
						canvas.toBlob(resolve, "image/jpeg", 0.8),
					);
					runtime.influenceLayer._isCapturing = false;
					runtime.influenceLayer.render();
					if (previewBlob) {
						const previewFile = new File([previewBlob], "preview.jpg", {
							type: "image/jpeg",
						});
						previewUrl = await websim.upload(previewFile);
					}
				}

				// 2. Generate and Upload JSON
				const saveData = runtime.generatePresetData(name);
				const blob = new Blob([JSON.stringify(saveData)], {
					type: "application/json",
				});
				const file = new File([blob], "scenario.json", {
					type: "application/json",
				});
				const blobUrl = await websim.upload(file);

				// Determine if this is a remix
				const _currentUser = await window.websim.getCurrentUser();
				let remixedFromId = null;
				let remixedFromName = null;

				// If current scenario context exists, it's a remix
				if (runtime.currentScenarioContext) {
					remixedFromId = runtime.currentScenarioContext.id;
					remixedFromName = runtime.currentScenarioContext.name;
				}

				// 3. Create Persistent Record
				await runtime.room.collection("scenario_v1").create({
					name: name,
					description: desc,
					previewUrl: previewUrl,
					blobUrl: blobUrl,
					remixed_from_id: remixedFromId,
					remixed_from_name: remixedFromName,
				});

				runtime.loadingOverlay.style.display = "none";
				showAlert(gameText("APP_66"));
			} catch (e) {
				console.error(e);
				showAlert(gameText("APP_67"));
				runtime.loadingOverlay.style.display = "none";
			}
		});
	}
	return {
		bindDeleteScenarioHandler,
		bindDeleteFlagHandler,
		bindImportFlagFromLibraryHandler,
		bindDeleteCountryHandler,
		bindImportFromLibraryHandler,
		bindPlayFromHubHandler,
		bindRemixFromHubHandler,
		bindGlobalChatCloseClick,
		bindGlobalChatSendClick,
		bindGlobalChatInputKeydown,
		bindItemCommentSubmitClick,
		bindItemCancelReplyBtnClick,
		bindCloseItemModalBtnClick,
		bindCancelUploadBtnClick,
		bindConfirmUploadBtnClick,
	};
}
