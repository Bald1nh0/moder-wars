# Repository agent instructions

Shared guidance for Claude Code, Codex, and other coding agents working in this repository.

## Single source of truth

`CLAUDE.md` is the canonical file. `AGENTS.md` is a relative symbolic link to `CLAUDE.md`, so both entry points expose the same instructions. Edit `CLAUDE.md` directly; do not replace `AGENTS.md` with a regular file or maintain a second copy. Preserve the symlink when checking out or copying the repository.

## Working agreements

- Discuss work in Ukrainian by default. Write code comments, configuration comments, documentation, and README content in English. Player-facing text must support English, Ukrainian, and Russian through the existing translation dictionaries.
- Keep changes focused, preserve project conventions, and verify behavior instead of inferring it from button labels or comments. Use browser checks for visual changes and user flows; Node smoke checks alone do not establish browser behavior.
- Preserve existing staged and unstaged work. Work on a feature branch and do not commit or push unless requested.
- Keep `CHANGELOG.md` current under the appropriate date and development version. Update these shared instructions when architecture, commands, or deployment practices change.

## Project

Modern Wars is a browser grand-strategy war simulator on a real-world map. It builds with Vite. The simulation, menus and most modules are JavaScript ES modules; the camera, projection, scene and PixiJS rendering modules (`src/*.ts`) are strict TypeScript. PixiJS and JSZip are npm dependencies bundled by Vite, so serving the source directory directly no longer works. `docs/MODERNIZATION.md` covers the build, deployment and rendering migration.

## Commands

```sh
npm ci --ignore-scripts                 # install locked dependencies (Node 24+; CI uses Node 26)
npm run dev                             # Vite dev server
npm run check                           # what CI runs: tsc, Biome, the smoke suite, build, build-output check
npm run build && npm run preview        # build the static site into dist/ and serve it
npm run lint                            # Biome; it only checks the paths listed in biome.json
node scripts/<name>-smoke.mjs           # run one smoke check, e.g. node scripts/simulation-core-smoke.mjs
node --experimental-vm-modules scripts/module-graph-smoke.mjs   # module graph + offline shell check
node scripts/profile-performance.mjs --help   # CLI simulation profiler (writes to performance-results/)
```

There is no test runner. "Tests" are the standalone `scripts/*-smoke.mjs` files, each a Node script that exits non-zero on failure. They exercise real simulation code (worker/core/client checks use Node worker threads) but never launch a browser, so they do not verify rendering or frame rate. `npm run smoke` runs the curated list in `scripts/modernization-smoke.mjs`; other smokes, including the AI ones, run individually. Run the smoke scripts that cover the modules you change. Shared fixtures are in `scripts/simulation-fixture.mjs` and `scripts/profiling/`.

Asset maintenance scripts (only run after changing their source data): `scripts/prepare-atlas-coast.mjs 110m|50m|10m`, `scripts/build-title-backdrop.mjs`, `scripts/build-scenario-binaries.mjs`, `scripts/build-geo-rasters.mjs`.

### Validate without replacing a running build

`npm run check` and the default build overwrite `dist/`. When a preview uses that directory, run the equivalent checks with a separate build output:

```sh
npm run typecheck && npm run lint && npm run smoke
npm run build -- --outDir /tmp/moder-wars-validation
MW_BUILD_DIR=/tmp/moder-wars-validation node scripts/build-output-smoke.mjs
npm run preview -- --outDir /tmp/moder-wars-validation --port 4176 --strictPort
```

Use an unused port and a separate directory for each concurrent validation. Check existing processes before starting or stopping servers. Keep any active playtest running unless the user asks to stop or update it.

## Release and caching rules

- The game version lives in places that must match: `<title>` in `index.html`, `CACHE_VERSION` in `workers/service-worker.js`, and `version` in `package.json` and `package-lock.json`. Bump them together when releasing.
- Pushes to main are checked and `dist/` is deployed to GitHub Pages by `.github/workflows/check-and-pages.yml`.
- Every module in `src/` (and other shell files) must be listed in `APP_SHELL_PATHS` in `workers/service-worker.js`. `module-graph-smoke.mjs` parses that list and fails if a reachable module is missing, so add new files there. The build rewrites the list with the emitted files.
- The root `service-worker.js` only `importScripts` the real implementation in `workers/` so it can control the whole site scope. The service worker caches aggressively; hard-refresh after source changes.
- Commit messages use conventional prefixes (`feat:`, `fix:`, `perf:`).
- `Dockerfile` copies an existing `dist/` into an Nginx image; it does not build the application. The public playtest at `https://modern-wars.bald1nh0.net/` uses an explicitly packaged image with no workspace mounts. Source changes and test builds must remain separate from release image updates.
- The current development preview uses port 4175 and `/tmp/moder-wars-ukraine-preview`; treat these as local session details and verify them before use. To update an authorized static preview, copy assets first and replace `index.html` last, retaining older hashed chunks for already-open sessions. Do not rebuild or restart the public container as part of routine validation.

## Architecture

**Entry.** `index.html` loads `src/entry.js`, which imports `src/bootstrap.js` (error overlay, service worker registration) and then `src/main.js`, a large (~7k lines) module that owns UI wiring and live game state. Systems receive state through `createLiveContext` (`src/runtime-context.js`), which builds getter/setter live bindings, so they don't import `main.js`. Only `renderer.js`, `editor.js`, `engine.js` and `firebase.js` still import from `main.js` directly.

**Simulation ownership.** The simulation runs in a resident module worker (`workers/war-simulation-worker.js`) built on `src/simulation-core.js`. The core composes the engine, world, state, tick, AI, territory and influence modules and is pure: no DOM, no `main.js`, so the same core runs in the worker, in Node smoke tests, and in the profiler. It advances on a fixed logical clock (`simulation-clock.js`) independent of rendering. Live clocks cap pending catch-up ticks at 60.
- `src/simulation-client.js` is the main-thread side. Rendering reads mirrors only. Any mutation (editing, diplomacy) needs an acknowledged ownership handoff, where full state is captured/applied via `src/simulation-protocol.js`.
- During play the worker sends presentation snapshots: packed unit positions plus only changed fields within dirty 32-cell map tiles. Stable graphs are omitted from later snapshots. Bump `SIMULATION_PROTOCOL_VERSION` when the wire format changes.
- Long-running work is split with `simulation-jobs.js` (deterministic resumable jobs) and `simulation-phase-wheel.js` (staggering phases across ticks).

**Army AI** (detailed in `docs/army-ai.md`). Strategic pipeline PROPOSE → WEIGH → DECIDE → EXECUTE → REASSESS in `ai-proposals.js`, `ai-planning.js`, `ai-plan-execution.js`, `ai-task-forces.js`, composed by `ai-runtime.js`. `army-command.js` splits fronts into sectors and assigns coverage, `army-navigation.js` builds bounded reverse-Dijkstra route fields, and `army-encirclement.js` handles encirclement. Each ordinary land formation has a single `_armyOrder` movement authority. Per-unit combat/movement is in `ground-unit.js` and `ground-movement.js`. Keep these modules browser-free.

**Presentation.** `presentation-runtime.js` paints snapshots at up to 30 Hz. `renderer.js` orchestrates rendering: PixiJS WebGL country meshes and unit sprites (`atlas-gpu.ts`, `atlas-scene.ts`, loaded on demand) under cached `render-*.js` Canvas overlays (labels, flags, selection, naval and battle markers, editor), with world-chunk caching and culling. The full Canvas path remains for capture, flag view and devices without WebGL. There is no Leaflet: `map-camera.ts` and `map-projection.ts` own the bounded Mercator camera, `camera-input.ts` owns drag, wheel, touch and keyboard input, and `map-runtime.ts` wires them together.

**Data.** Scenarios are compiled to MWSC v3 binaries (`assets/maps/compiled/*.mwsc.gz`) by `scenario-codec.js`. The v2 decoder and JSON import/export are still supported. Decoding runs in `workers/scenario-worker.js`. Geography is Natural Earth GeoJSON at 110m/50m/10m with derived rasters (`assets/geodata/derived/*.mwr`) and packed coastlines (`assets/atlas/`). Raw reference geography is loaded only when an editing tool needs it. Influence grids use lazy Float32 pages (`influence-grid.js`).

**Other subsystems.** Editor (`editor*.js`), community sharing via Firebase (`community-*.js`, `firebase.js`), i18n (`i18n.js`, `translations.js`), preferences/settings, and in-game performance profiling (`performance-*.js`).

## Scenario and interface invariants

- Modern Day 2026 is built offline from a pinned Overture Maps division-area snapshot; preserve ODbL attribution, source dates, and reproducibility in `assets/scenarios/modern-2026/`. Do not relabel inherited economic/game-balance parameters as 2026 statistics or infer military control from administrative boundaries. The benchmark's default 2022 package remains pinned independently so changing the play menu does not silently change its workload.
- Regional theaters retain global cell coordinates but explicitly mask excluded countries and constrain the camera. Keep theater metadata through export/load/restart and reset camera constraints when switching back to a world scenario. Do not claim reduced grid allocation merely from masking geography.

- `admin-regions.js` and `render-admin-regions.js` lazily load compact Natural Earth administrative boundaries for Earth maps. These are a modern reference overlay, not simulation provinces or historical frontlines. Preserve Ukrainian region grouping and source attribution in `assets/geodata/admin1/README.md`. `docs/GEOGRAPHIC-DATA.md` records source options and regional-scenario constraints.

- The experimental Ukraine scenario is an approximate reconstruction for 2023-01-01, not a live map feed. Its armies are fictional game data. Preserve attribution and limitations in `assets/scenarios/ukraine-2023/README.md`. Regenerate its binary with `scripts/build-ukraine-scenario.mjs` only when its inputs change, and update the asset revision in `src/scenario-codec.js`.
- Sovereignty (`deJureMap`) is distinct from military control (`worldControlMap` and wartime influence). Preserve `sovereigntyOverrides` and `historicalSource` across load, export, and restart. Update scenario context through `setCurrentScenarioContext`; do not assign to imported ES module bindings.
- `occupation-regions.js` caches occupied regions within the scenario's `historicalSource.territoryOwnerIds` scope. `render-occupation.js` draws outlines, hatching, and localized controller labels on the existing dynamic canvas. Keep liberated and allied-controlled territory out of the occupation overlay; clear its cache after bulk static changes.
- `leaderboard.js` counts living formations and their actual deployed personnel from the simulation mirror. Recruitment estimates and pooled reserves are not deployed units. Territory is a count of controlled grid cells, not square kilometres. Refresh an open leaderboard at most once per second.
- **Menu → Main menu** is wired in `menu-controls.js`. It pauses a running battle while asking for confirmation; cancellation restores the prior pause state. Confirmation stops the simulation client and reloads the title screen without saving the current session. Language and saved preferences persist. Do not imply that this is a save/resume feature.
- Relevant regressions: `occupation-regions-smoke.mjs`, `leaderboard-smoke.mjs`, `ukraine-scenario-smoke.mjs`, `scenario-territory-smoke.mjs`, `editor-startup-smoke.mjs`, `ui-modernization-smoke.mjs`, and `i18n-smoke.mjs`.

## Known state and performance

- `docs/BACKLOG.md` separates browser optimization, backend persistence, and server simulation proposals. Measure the current release before choosing implementation; adding a database alone does not accelerate simulation. Keep reproducible benchmark workloads distinct from browser observations and real-device measurements. Current-release evidence is in `docs/PERFORMANCE-0.28.6.md` and `docs/PERFORMANCE-BROWSER-0.28.6.md`; the headless browser used SwiftShader, so its frame rate is not a real-device FPS result.

- The development scenario menu exposes Modern Day 2026 (political geography, not live frontlines) and Ukraine 2023 · Eurasia. Legacy 2022 data remains as a compatibility/reference input. The frozen Docker playtest remains on its explicitly packaged image; source edits and local builds do not deploy to it. See README for Docker lifecycle and assets/scenarios/ukraine-2023/README.md for provenance and limitations. Older era data, thumbnails, hidden cards, and dormant handlers still exist and are not supported eras.
- `docs/PERFORMANCE-AUDIT.md` records measured CPU bottlenecks: per-unit enemy scans in `ground-unit.js`, proposal scoring in `ai-plan-execution.js` (proposal generation is now budgeted across ticks; see `docs/army-ai.md`), and full-world frontier scans in `frontline-core.js`. Check it before doing performance work, and measure with `scripts/profile-performance.mjs`.
