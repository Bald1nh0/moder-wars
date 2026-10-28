# Modern Wars

A browser-based grand strategy war simulation played on a real-world map. Choose countries or alliances, start a conflict, and follow the frontlines, manpower, casualties, and original territory retained.

## Status

**Active development.** This is a dev build, so expect bugs, balance issues, rough UI, and incomplete systems.

## Running

Open https://vaspyyy.github.io/moder-wars/ in a browser.

The game opens directly at the main menu with default or remembered preferences. Fullscreen is available only through an explicit menu action.

For local development, use Node 24 or newer:

```sh
npm ci --ignore-scripts
npm run dev
```

`npm run check` runs strict TypeScript checks for the new engine modules, lint, Node regressions, a production build, and offline asset checks. `npm run build` outputs the static site to `dist/`; `npm run preview` serves that output. See [the migration and deployment notes](docs/MODERNIZATION.md) before merging or deploying.

## Frozen Docker playtest

Stable playtest: **https://modern-wars.bald1nh0.net/**. The existing HTTPS reverse
proxy forwards to the frozen container on LAN port 4174; TLS terminates at the
proxy. Development and experimental scenario builds are not deployed there
automatically.

Docker packages the **existing `dist/` directory** into an image. It does not run
Node or rebuild the game. There are no workspace mounts, so subsequent source
edits and local builds cannot change the running container. Docker Engine with
Compose v2 and a completed `dist/` build are required.

Current published image: `moder-wars:0.28.6-playtest`. To publish a later tested
build, replace `<NEW_VERSION>` below with a new version and start it:

```sh
export MW_IMAGE="moder-wars:<NEW_VERSION>-playtest"
docker compose build
docker compose up -d --no-build --pull never
docker compose ps
```

The default URL is `http://127.0.0.1:4174/`. For another device on the same LAN,
set `MW_BIND_ADDRESS` to this machine's LAN address before `docker compose up`;
`MW_PORT` overrides port 4174. For example:

```sh
export MW_BIND_ADDRESS=192.168.31.224
export MW_PORT=4174
docker compose up -d --no-build --pull never
```

Use the same variables for later Compose commands. `docker compose logs --tail
100 game` shows access/error logs; `docker compose stop game` stops this playtest.
The container runs Nginx as an unprivileged user with a read-only filesystem,
temporary runtime storage and an HTTP health check. No server-side game state
is stored: each browser still owns its simulation and preferences.

For an update, build a reviewed `dist/`, package it under a **new image tag**,
then deliberately recreate the service. Keep old tags for rollback; select an
old `MW_IMAGE` and run `docker compose up -d --no-build --pull never`. Do not
rebuild a published playtest tag. To test source changes without touching an
existing Vite preview's `dist/`, use a separate output directory, for example
`npm run build -- --outDir /tmp/moder-wars-preview`.

## Current Era

The **Choose scenario** menu exposes:

- **2026 Modern Day** - political geography rebuilt from the Overture Maps 2026-10-21 release, with a separate administrative-region overlay. No live frontlines; forces and economic values are game parameters. See [source and reproduction](assets/scenarios/modern-2026/README.md).
- **Ukraine 2023 · Eurasia** - a regional theater with approximate control on 2023-01-01 based on attributed DeepState visual contours, with fictional game armies. See [source, reproduction and limitations](assets/scenarios/ukraine-2023/README.md).

The frozen 0.28.6 Docker release includes these scenarios. The previous 0.28.5 image remains available for rollback. Backend and performance proposals are tracked in [the backlog](docs/BACKLOG.md); no backend or database has been added.

Current measurements: [0.28.6 CPU baseline](docs/PERFORMANCE-0.28.6.md) and
[released-build browser observations](docs/PERFORMANCE-BROWSER-0.28.6.md).
The headless browser uses software graphics; its FPS is not a real-device result.

## What You Can Do

- **PLAY** opens the scenario chooser, including Modern Day 2026 and Ukraine 2023 · Eurasia. The Basic panel covers AI posture and war rules, with + Side and FFA above the side cards. Optional manpower totals, date, and capture rules remain under Advanced. The simulation uses ground formations, naval planning, and optional missiles.
- **War Overview** shows manpower, casualties, and the percentage of original territory retained for each side and its countries. Country manpower shows deployed personnel; side manpower includes pooled reserves. Country rows are indented beneath their side totals.
- **EDITOR** redraws borders, creates countries, manages cities, and saves or loads scenarios.
- **COMMUNITY** browses, uploads, remixes, and downloads shared scenarios or countries.
- **SETTINGS** groups preferences into Gameplay, Display, Audio, Interface, and Advanced. Benchmark and performance tuning live under Advanced.
- Country cards keep identity and manpower visible, with buffs, allies, role, and doctrine under **Configure**.
- **Menu → Main menu** asks before ending the current session without saving. The battle pauses while the question is open; cancelling restores its previous pause state. Confirming reloads the title screen, preserving language and saved preferences but discarding the current battle.
- The live toolbar has a five-bar speed selector: click 1×, 2×, 3×, 5× or 10× directly. Filled bars show the selected level; pausing retains your chosen speed. Restart, sandbox, sound, help, fullscreen, and navigation actions live under **Menu**.
- **God Mode** and editor tools can stage custom wars, alter borders, and test scenarios.
- Major rivers and mountain ranges act as defensive lines: formations holding them on friendly ground take less damage, and crossing a river into enemy land is slow. A country whose capital falls suffers a short morale shock on top of the lasting penalty.
- Outnumbered fronts fall back to the nearest river or mountain line behind them, and so does every front for a few seconds after a capital falls. Attackers route around enemy-held rivers and prefer pincers over frontal attacks into dug-in lines.
- Sealed encirclement pockets are shaded with a pulsing red hatch while **Show Battle Visuals** is on. Formations in a sealed pocket take mounting attrition and surrender after about five seconds at 1x; they try to break out toward friendly land while nearby formations attack the ring from outside. **Settings → Visuals → Fade Captured Land** tints newly captured cells with their previous side's colour as they change hands.

## Map Appearance

The default **Atlas (Menu Style)** view uses a blue ocean, restrained country colors, geographic coastlines, coastal shading, fine territory contours, and smaller labels. Capitals remain visible at world scale; other cities appear as you zoom in, with active theater cities retained. Country and city labels avoid overlapping their peers.

Atlas is the only visual style. Custom terrain, resized worlds, and editing use contours from the live grid so painted land is preserved. Ownership, occupation, and hit testing continue to use the simulation grid. The native camera handles dragging and zoom; PixiJS retains GPU country meshes and unit sprites, with cached Canvas overlays and a complete Canvas fallback for capture, flag view, and devices without WebGL.

Coastlines follow the selected 110m, 50m or 10m geography resolution. The small 110m asset is included in the offline shell; higher-resolution coastlines download on demand and enter the runtime cache. If geography cannot load, Atlas uses its grid coastline fallback.

During a war, soldier totals appear separately for each home country on each disconnected front. The numbers curve along the front on the troops' side, with a national flag and space between coalition members. Totals use surviving deployed land personnel across the whole front, so panning does not change them. Formations are counted once against their nearest front within six latitude-equivalent degrees; distant reserves and overseas garrisons receive local labels, with water gaps keeping islands separate.

## Administrative regions

Earth scenarios show modern region and oblast borders when zoomed in, with region names at closer scales. Toggle **Settings → Display → Show regions / oblasts**; this preference persists. These reference borders do not change military control, occupation, or gameplay provinces, and do not appear on custom terrain or in the map editor. The source covers most countries; see [data provenance](assets/geodata/admin1/README.md) and [geographic data / regional scenarios](docs/GEOGRAPHIC-DATA.md).

## Leaderboard

Territory counts controlled map grid cells, including occupied land. It is not an area in square kilometres; cell area varies with latitude.

The leaderboard shows living units and deployed soldiers in separate columns,
using the same formation personnel data as the map and war overview. Shared
side reserves are excluded because they have no per-country allocation.
Countries without deployed forces show zero, including before a war starts.
Open rankings refresh once per second during simulation, including while paused.
These are simulation values; scenario recruitment remains game-generated.

## Custom Scenarios

Modern Wars can load custom scenario files and community scenarios. This is separate from the built-in era picker: the editor and community tools can create, import, remix, and share additional setups.

## Controls

- Click-and-drag to pan. Wheel and trackpad zoom ease continuously toward the cursor; reversing the wheel immediately reverses the camera.
- Click a country to inspect it and assign it during setup
- During a war, hover near a front to see both sides' troops on that stretch and which side is advancing
- Space pauses/resumes during a war; + / − changes the speed level. The speed selector also supports native radio-button arrow-key navigation.

Speeds are target multipliers: large wars may reach the CPU's simulation limit before 5× or 10×. Lowering speed immediately clears accumulated catch-up time. Live clocks keep at most 60 pending ticks, so a slow period cannot leave minutes of time queued. Each completed tick still performs the full simulation; the calendar advances only for completed ticks.

## Known State

Older era data, thumbnails, hidden cards, dormant click handlers, and import presets may still exist in the codebase. They are not currently exposed as supported main-menu eras unless they are visible in the **Choose Era** screen.

## Development Notes

Atlas coast assets contain compressed packed coordinates derived from the bundled Natural Earth data, without feature properties. Regenerate an asset with `node scripts/prepare-atlas-coast.mjs 110m` (or `50m` / `10m`), then rebuild the static site.

Camera movement transforms buffered canvas layers during gestures and repaints near the buffer edge or when movement ends. Zoom detail levels retain their country geometry. Captures and recordings use a viewport-sized canvas.

Map rendering uses a shared memory budget for Canvas, WebGL and coastline masks: at most 2× device pixel ratio, approximately two million pixels per surface, and a 4096-pixel edge limit. Small viewports use 96 CSS pixels of camera overscan instead of 192. Large or high-density screens may render the map below native resolution; HTML controls keep their normal resolution. These limits reduce backing-store allocations, not the memory used by simulation grids or browser/driver copies. They also apply when capturing the viewport.

GPU country chunks release their owned graphics contexts immediately. Repeated political-style changes reuse a bounded gradient texture palette, and unused flag textures are evicted. These changes address known memory pressure; they do not prove that every browser tab crash is fixed. If a device still runs out of memory, lower Grid Density and Map Resolution in Settings and test a smaller conflict at 1× speed.

`src/camera-input.ts` owns pointer, wheel, touch, and keyboard camera input. It publishes camera changes at most once per display frame, anchors wheel zoom at the cursor, and cancels momentum on resets. Reduced-motion preferences skip easing and inertia. Buffered Canvas overlays replenish near their edges, while GPU country meshes follow the camera matrix.

Run `node scripts/native-camera-smoke.mjs` for projection round trips, cursor anchoring, coalesced dragging, pinch transitions, inertia, cancellation, editor ownership, and camera bounds. `atlas-scene-smoke.mjs` checks retained geometry and neighboring chunk invalidation; `atlas-gpu-smoke.mjs` checks real Pixi drawing instructions and fallback control flow in Node. These do not launch a browser or execute GPU rendering.

Run `node scripts/camera-performance-smoke.mjs` to check exact cached half-cell projections against a full-Earth fixture. It reports Node CPU work and projection counts, not browser or GPU frame rate. For comparison, pass `--compare /path/to/previous-renderer.js` to use an earlier renderer's projection block on the same fixture.

Run `node scripts/atlas-smoke.mjs` for atlas topology, coastline, occupation, edited-map, full-Earth cache, and offline-shell checks. Verification remains source inspection, Biome, and Node smoke checks; these checks do not establish browser rendering or frame rate.

The title screen uses a dedicated vector backdrop with bundled 50m geography and scenario colors. Regenerate it with `node scripts/build-title-backdrop.mjs` after changing those source assets.

- Install the locked npm dependencies and use Vite for local development.
- Deploy the production output from `dist/` through the GitHub Actions Pages workflow.
- The service worker caches aggressively. After source changes, hard-refresh the browser or bump `CACHE_VERSION`.
- Game version appears in both `index.html` and `workers/service-worker.js`; keep them in sync.

## Tech

Vite, strict TypeScript camera/scene modules, PixiJS WebGL with Canvas overlays and fallback, existing JavaScript menus and simulation, IndexedDB caching, and a resident simulation worker. The simulation advances on a fixed logical clock independent of rendering; the UI receives packed unit positions and changed 32-cell map tiles. Editing and diplomacy take an acknowledged state handoff. Country geometry caches world chunks across camera movement.

Presentation paints fresh snapshots at up to 30 Hz independently of monitor refresh, with immediate camera settlement and bounded deferral after expensive snapshot intake. HUD values update only when their displayed text changes. Unit mirrors retain ID lookups and spatial buckets; flag sprites and strength badges are cached by their actual inputs.

Map snapshots send only changed fields within dirty tiles. Occupation-intensity updates refresh city markers without rebuilding political meshes or country regions. Partial political paints traverse the affected tile set, including seam padding, and reuse projected polygon paths. Stable presentation graphs are omitted from later worker snapshots; frequently changing graphs bypass repeated comparisons until a periodic recheck. Full ownership handoffs still return complete state.

Compiled scenarios use MWSC v3 with compact saved-territory runs and deduplicated flag blobs; the v2 decoder and JSON import/export remain supported. Raw reference geography is loaded only when an editing tool needs it. Worker influence grids use lazy Float32 pages; legacy editing receives dense arrays on demand.

## Offline Verification

Run `npm run check` for the integration suite and production output checks. Individual checks use `node scripts/<name>-smoke.mjs`; the module-graph check requires `node --experimental-vm-modules scripts/module-graph-smoke.mjs`. Worker/core/client checks use actual simulation code and Node worker threads without a browser.

The suite includes retreat-target stability, army formation defaults, core AI operations, and rendering-budget regressions. Coastline and river loaders are tested with both raw gzip payloads and HTTP responses already decompressed by the browser. `node scripts/render-budget-smoke.mjs` reports calculated Canvas backing-store sizes; it does not measure browser RSS or GPU memory.

Run `node scripts/soldier-labels-smoke.mjs` for separate fronts, country ownership, surviving personnel, worker snapshots, isolated garrisons, longitude wrapping, curved canvas commands and camera-independent totals. It also reports grouping CPU time for 2,400 formations across 24 fronts; this is a synthetic Node measurement.

The presentation checks are `presentation-runtime-smoke.mjs`, `render-chunks-smoke.mjs`, `render-passes-smoke.mjs`, `unit-render-cache-smoke.mjs`, `simulation-client-smoke.mjs`, and `simulation-worker-smoke.mjs`. They cover fresh-data cadence at different display rates, intake budgets, stable unit identity/removal, sparse terrain paints, flag/badge cache invalidation and ordered transport. `camera-performance-smoke.mjs` reports full and sparse political-paint CPU work; it does not establish browser frame rate.

Measured CPU probes during the performance refactor (synthetic fixtures, not browser FPS):

| Probe | Before | After |
| --- | ---: | ---: |
| Repeated 180,000-cell terrain paint | 75.2–95.3 ms | 6.1–6.5 ms |
| Unchanged 1,200-member allocation among 2,400 units | 24.55 ms | 0.76 ms |
| Eligible dense friendly group of 1,000 units | 12.36 ms | 0.053 ms |
| Modern Day compressed package | 1,109,544 bytes | 282,918 bytes |

Sparse influence pages reduce memory for regional wars, with extra scalar lookup cost; `node scripts/influence-storage-benchmark.mjs` measures that tradeoff. Full ownership transfers remain intentionally limited to starting wars and explicit UI edits.

The live overview keeps only current values. Intelligence/contact memory, economy, rebellions, armor, air power, occupation garrisons, experiment recording, rematches, interventions, and native runtime checkpoint exports have been removed. Existing scenario files still load; obsolete options are ignored.

## Code organization

`src/main.js` owns startup, browser state mirrors, menus, and editor integration. Live getter/setter bindings in `runtime-context.js` let browser controllers observe replaced arrays and current state without importing `main.js`. The independent simulation owner in `simulation-core.js` composes combat, AI, influence, territory, and calendar modules through explicit dependencies. `simulation-client.js` synchronizes controls and drawing snapshots, and returns full ownership before browser edits.

`src/editor.js` wires editor tools; `geography-loader.js` and `scenario-loader.js` handle geography and scenario loading. `src/renderer.js` owns the Canvas layer and caches, with separate terrain, unit, label, overlay, and flag passes. Translation data, language application, audio, settings, and exports also have their own modules.

The army AI reserves persistent front sectors and theater reserves before recruiting offensive task forces. Formations receive distinct positions and one authoritative movement order. Shared, budgeted navigation avoids water and neutral territory, while actual enemy contact still resolves combat. Operations assemble, breach, exploit, secure, withdraw and regroup; encirclement proposals either close a narrow enemy salient or envelop a stretch of enemy front with two converging arms, and score well above frontal pushes. Depleted formations rotate out and can replenish from existing reserve personnel.

Enable **Settings → Display → Show Army Decisions** to inspect sector coverage, formation destinations, reserves and withdrawal reasons for the observed side. The optional overlay uses bounded samples. See [Army AI architecture and verification](docs/army-ai.md) for ownership, scheduling, limits and offline evaluation commands. The separate player Commander mode remains retired.

Run `biome check .` after editing. Individual offline checks live in `scripts/*-smoke.mjs`; the module graph check requires `node --experimental-vm-modules scripts/module-graph-smoke.mjs`. It verifies imports and offline-cache coverage without evaluating game code. `render-passes-smoke.mjs` additionally accepts `MW_RENDER_BASELINE` for an optional renderer comparison and uses native Canvas when available for flag-clipping checks. These scripts are offline checks, not interactive playtests.

## Terminal Profiling

Run the actual simulation against the bundled 2022 map, without opening a browser:

```sh
node scripts/profile-performance.mjs
node scripts/profile-performance.mjs --case regional --heap --phases
node scripts/profile-performance.mjs --case regional --spread --output /tmp/mw-spread
node scripts/profile-performance.mjs --compare /tmp/previous/report.json
```

The default suite covers Turkey–Iraq, Russia–China, and a four-country European FFA at standard grid resolution. It runs three fresh timing processes per case, then a separate V8 CPU sampling pass and a Node worker transport probe. `--heap` adds allocation sampling; `--phases` adds a separate intrusive timer/counter pass. `--help` lists army size, resolution, warmup, repetition, and output controls. Use the project's supported Node version and installed dependencies.

Reports default to the ignored `performance-results/` directory. Each output directory contains a terminal-readable `report.txt`, a machine-readable `report.json`, and `.cpuprofile` files, plus `.heapprofile` files when requested. Baseline comparisons reject changed workloads, hardware, OS, or Node versions. Keep the machine otherwise idle for timing runs. Debug console logging is suppressed in benchmark processes.

These are controlled deployments using real map data, not exact menu-start reproductions. Loading and warmup are excluded from tick statistics. Worker transport exercises the production core, packed snapshots, changed map tiles, and mirror application through Node worker threads at two logical ticks per snapshot; it excludes the browser worker's real-time timer and rendering. CPU and heap sampling are separate from the reported timing runs. Heap sampling estimates allocation churn, including collected objects; ArrayBuffer memory is reported separately. This measures CPU costs, not browser FPS or GPU rendering.

See [the measured bottleneck audit](docs/PERFORMANCE-AUDIT.md) for results and priorities. The harness uses [Node's V8 inspector](https://nodejs.org/api/inspector.html#cpu-profiler) and keeps all profiling machinery out of the game's runtime.

## Interface languages

Select a language under **Settings → Interface → Language**. The selection is saved immediately in the `mw_lang` cookie for one year and restored on reload in the same browser profile. Clearing site cookies removes the preference. Tabs on the same hostname share the stored preference, while their simulations remain independent.

English, Ukrainian and Russian cover the interface dictionaries, menus, settings, tooltips, editor controls and gameplay messages. Built-in country names are localized; user-authored scenario names, descriptions, comments and custom names remain unchanged. Other listed languages retain their existing partial translations and fall back to English. Technical diagnostic codes and developer profiling output remain in English.

Run `node scripts/i18n-smoke.mjs` to check dictionary coverage, placeholders, HTML references, translated attributes and language restoration. This check is also included in `npm run check`.

## Experimental server simulation

The `experiment/server-simulation` branch adds an opt-in Node/WebSocket owner for
isolated browser sessions. See [setup, comparison URLs, and limitations](docs/SERVER-SIMULATION-PROTOTYPE.md).
The stable Docker game remains independent; no database or public deployment is
required for this experiment.

Enable **Settings → Advanced → Performance testing** in the prototype for browser/server
comparison runs and downloadable device reports. The flag is off by default;
`?performanceTest=1` also exposes it. See the prototype guide above for test conditions.

Normal play defaults to browser simulation. The separate **Settings → Advanced →
Server simulation (experimental)** switch saves an opt-in for future page loads.
Use its **Open a new game** link to apply the choice in a fresh tab; the current
game keeps its mode. Explicit `?simulation=browser` or `?simulation=server` links
override the saved preference. Server mode requires the prototype backend at the
same origin; a static Docker image alone does not provide it.

## Experimental campaign

The `feature/forces-economy-events` branch adds country economies, formation roles,
production, mobilization, aggregate missions and an event journal. Open the map
menu → **Forces & economy** after starting a war. See
[the campaign guide](docs/CAMPAIGN-GUIDE.md) for controls, data provenance and
limitations. Browser simulation remains the default; the public Docker image is
updated separately from this experimental preview.
