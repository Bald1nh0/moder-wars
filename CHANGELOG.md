# Changelog

## 2026-10-28

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
