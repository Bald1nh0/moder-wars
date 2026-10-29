# Changelog

## 2026-10-29

### 0.29.0

- Release the campaign tested in experimental.1–3: country economies, formation roles, training and production, mobilization, aggregate missions and the event journal, with English, Ukrainian and Russian controls and help.
- Include responsive conflict setup, HUD menu and country inspector fixes, plus tutorial navigation inside the campaign dialog and shortcuts to its controls.
- Advance the application and service-worker cache versions together. Package the public Docker playtest as `moder-wars:0.29.0-playtest`, retaining 0.28.6 for rollback and keeping the port 4180 preview independent.
- Keep browser simulation as the default. The static Docker release does not deploy the optional server prototype or add persistent game saves.

### 0.29.0-experimental.3 (experimental, unreleased)

- Wrap long HUD menu actions and constrain their width, keeping vertical scrolling without a horizontal scrollbar.
- Give the country inspector its own bounded, content-sized layout, wrapping action rows and a reachable close button. Preserve editor action-grid layout when reopening the inspector.
- Keep active tutorial navigation inside the Forces & economy dialog, preserve its page when returning to the map, and make recruitment/production instructions explicit in English, Ukrainian and Russian. Add guide shortcuts to the relevant campaign controls.
- Publish experimental.3 to the isolated port 4180 preview without restarting the simulation server; retain older assets for open sessions.

### 0.29.0-experimental.2 (experimental, unreleased)

- Keep conflict sides within the setup panel, wrap long translated country names, and stack cards on narrow screens. Additional sides wrap without horizontal scrolling.
- Extend the English, Ukrainian and Russian tutorial with forces, economy, city construction, mobilization, missions, the event journal and session limits. Keep navigation reachable on small screens and show a localized step counter.
- Make manually opened game help a reference that preserves the current scenario and selected countries; retain the guided setup handlers and the separate editor guide.
- Publish the UI update on the isolated port 4180 preview without restarting its server, retaining older assets for open sessions.

- Move the isolated `0.29.0-experimental.1` campaign preview to port 4180, replacing the older server prototype there, and stop the duplicate listener on 4182. Keep the public Docker release unchanged.

## 2026-10-28

### 0.29.0-experimental.1 (experimental, unreleased)

- Keep the open HUD menu above the mobile war overview so every action remains reachable.
- Add a playable campaign panel in English, Ukrainian and Russian with explicit formation/personnel counts, role composition, budgets, equipment stocks, city construction, training and production queues, mobilization and demobilization.
- Fund player and AI actions from the same country budgets; preserve resource accounting across deployment, casualties, cancellation, city capture and changes of side. Keep formations bounded and calculate role/mission effects without individual vehicle objects.
- Add aggregate aviation, air defense, reconnaissance, strike-drone and missile mechanics; decorative flights do not apply duplicate impact damage.
- Add a bounded event journal with optional popups, city/capital captures, country events and sparse administrative control checks for Ukraine's 27 regions.
- Bundle dated public country profiles and a limited sourced equipment sample, preserving unknowns, provenance and licenses. Distinguish game assumptions and game vassalage from factual observations and formal constitutional relationships.
- Preserve force-profile/dependency metadata and stable country identity across scenario exports/imports. Carry campaign state through acknowledged ownership handoffs and omit internal region indexes from presentation traffic.
- Keep browser simulation as the default, retain the optional server flag and pin existing performance benchmarks to their previous workload. Publish the new experiment separately from the frozen Docker playtest.

### 0.28.7-server.3 (experimental, unreleased)

- Add a separate persistent server-simulation feature flag, off by default, with an explicit current-tab mode and a fresh-game link; switching the preference leaves the current game intact.
- Pin browser/server benchmark links to their requested owner regardless of the saved play preference.
- Record the proposed force composition, city economy, mobilization, event journal and dependency systems, including existing mechanics, public sources and data limitations.

### 0.28.7-server.2 (experimental, unreleased)

- Record the player's Android comparison: similar observed simulation rates, fewer remote-mode paint calls, and substantial client rendering cost in both modes.
- Record the player's real Mac comparison: healthy local worker, slower server logical pace, and the distinction between animation callbacks and actual render calls.
- Add an opt-in device performance test with a persistent feature toggle, separate browser/server runs, owner diagnostics, and downloadable reports.
- Record negotiated WebSocket extensions alongside uncompressed packet counters.
- Document evidence-based follow-up experiments for scenario initialization, presentation traffic, navigation, regional grids, compression, and backend technology choices.

### 0.28.7-server.1 (experimental, unreleased)

- Add an opt-in Node/WebSocket simulation prototype with an isolated simulation worker per browser session, binary state transport, explicit connection status, and failure handling.
- Yield the Node worker between backlogged simulation turns so browser acknowledgements and controls remain responsive; wait for socket closure before replacing a full-capacity session.
- Keep normal browser simulation and the frozen 0.28.6 Docker release available for comparison; no database, shared multiplayer rooms, or persistent saves are introduced.

### 0.28.6

- Package the tested 0.28.6 build for the Docker playtest, retaining 0.28.5 for rollback; the application version was already bumped during development.
- Record browser optimization, backend persistence, and server-owned simulation as separate backlog options pending current-release measurements.
- Record a current-engine CPU baseline and released-build browser observations, including reproducible world-map worker startup fallback; keep profiling results separate from real-device FPS claims.

- Increase administrative-boundary contrast and stroke width while retaining a distinct dashed style.
- Restrict the Ukraine 2023 scenario to a Eurasian theater, with explicit geographic scope and camera bounds. Global grid coordinates remain compatible with the simulation.
- Replace the main Modern Day selection with a 2026 political-geography scenario from the dated Overture release; armies and economic inputs remain game parameters, not current military statistics.
- Preserve regional and sourced political maps when a scenario reload fails instead of silently regenerating legacy world geography.
- Translate new territory names into Ukrainian and Russian; keep both scenario cards accessible through page scrolling and restore the chooser after a failed load.

### 0.28.5

- Release the changes tested as 0.28.4 in the isolated Docker playtest image; advance application and browser-cache versions together. Retain the 0.28.3 image for rollback.

- Add a zoom-dependent administrative-region overlay with localized names and a persistent display toggle; keep it separate from military control and custom maps.
- Document public geographic-data sources, geoBoundaries date metadata, and the distinction between camera bounds and a smaller regional simulation.

- Update shared coding-agent guidance and link `AGENTS.md` to the canonical `CLAUDE.md` so both entry points stay identical.

- Explain leaderboard territory cells and wire Main menu to a localized exit confirmation that pauses the battle and restores its previous pause state on cancellation.

- Outline and hatch occupied territory in the Ukraine scenario using sovereign ownership and live military control, with localized controller labels and cached geometry.
- Replace leaderboard recruitment estimates with actual living unit counts and deployed personnel; refresh open rankings and clarify excluded shared reserves.

- Make scenario selection explicit with a localized checkmark label, contrasting active border and accessible pressed state; remove permanent highlighting from Modern Day.

- Package existing static builds into an isolated Docker/Nginx image without workspace mounts; document the stable HTTPS playtest and deliberate image updates.
- Make Vite static asset packaging respect the selected output directory so isolated test builds do not modify a running preview.
- Add an experimental Ukraine scenario for 2023-01-01 using attributed visible DeepState contours, an offline reproducible compiler, and English/Ukrainian/Russian menu text.
- Keep sovereign territory separate from military control in scenario loading, export and restart; restore Ukrainian sovereignty over Crimea and occupied Donbas.
- Add scenario reproduction, landmark-control and sovereignty remapping regressions.

### 0.28.3

- Complete Russian and Ukrainian interface dictionaries and connect menus, settings, editor controls, tooltips, accessible labels and dynamic gameplay messages.
- Localize built-in country names and map operation labels while preserving scenario identifiers and user-authored content.
- Persist language immediately, restore it on reload and refresh active interface elements when switching languages.
- Add translation coverage, interpolation, attribute and language-switching regression checks.

### 0.28.2

- Fix missing unit flags and country colors on large or high-DPI displays: compare rounded backing dimensions before resizing Pixi canvases.
- Resume map presentation after returning to a tab while editing an active or completed conflict in God Mode.
- Add regressions using real Pixi canvas sizing at fractional rendering resolutions and visibility transitions.

### 0.28.1

- Bound map rendering resolution and camera overscan consistently across Canvas, WebGL and coastline masks to reduce memory pressure on phones and large displays.
- Release owned graphics contexts and detached Canvas backing stores; reuse bounded gradient textures and evict unused flag textures.
- Decode coastline and river assets correctly whether HTTP has already decompressed them; allow bounded coastline retries after transient failures.
- Keep valid multi-row formation retreat targets stable across repeated orders and reassign destinations when their cells become hostile.
- Repair outdated formation/retreat fixtures and include key AI and rendering-budget regressions in the standard check suite.
- Update Vite to 8.3.5 and advance the application/offline cache version together.

Browser tab crashes reported as "Aw, Snap!" have not been tied to a specific
crash dump. Rendering budgets and lifecycle fixes mitigate confirmed resource
issues; real-device testing remains necessary.
