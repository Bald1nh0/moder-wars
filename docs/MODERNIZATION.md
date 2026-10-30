# Atlas modernization

Modern Wars now builds with Vite. New camera, projection, native reference controls, retained scene, and PixiJS rendering modules use strict TypeScript. Existing simulation and menus remain JavaScript; a language conversion is not a simulation optimization.

## Development and deployment

Use Node 24 or newer (CI uses Node 26), then `npm ci --ignore-scripts` and `npm run dev`. Development and preview servers use strict port **4180**; coordinate replacing the existing test server instead of starting another persistent preview. `npm run check` checks typed modules, runs Biome and the Node integration suite, builds production files, and verifies emitted workers and offline cache paths. `npm run build` writes a self-contained static site to `dist/`. `npm run preview` serves that output. Serving the source directory directly is no longer supported.

Production is the frozen Docker image at `https://modern-wars.bald1nh0.net/`, forwarded through LAN port 4174. The test deployment uses port 4180 and separate build/source snapshots. See [deployment setup](DEPLOYMENT.md) for the release workflow and planned dedicated Docker host.

`.github/workflows/check-and-deploy.yml` replaces the earlier Pages pipeline. PR checks and container builds run on GitHub-hosted runners; a successful push to `main` publishes the tested image to GHCR and deploys its immutable digest using the production runner. The application is built once; the Docker host only pulls and runs the image. Environment/runner setup and the initial proxy cutover are explicit prerequisites, not effects of a local build.

Vite bundles the worker entry points, JSZip, and PixiJS locally. The build copies `assets/` without changing scenario or geography formats. A build-generated offline manifest includes emitted scripts, CSS, workers, and default Atlas assets. Geography, scenario files, and non-default coastlines remain runtime cached. Registration is disabled in Vite development to avoid caching the dev server. Runtime data caches survive patch updates, following the existing policy.

## Camera and input

The camera owns a bounded Mercator world, viewport dimensions, world-to-screen conversion, continuous zoom, and country/world fitting. Simulation positions remain latitude/longitude. A single input controller maps drag, wheel, keyboard, double-click, and touch pinch into camera gestures. Pointer input is coalesced per animation frame, wheel zoom remains anchored at the cursor, and scenario changes cancel outstanding momentum. Editor painting takes ownership before dragging begins. Reference image handles use native pointer capture and explicitly invalidate the renderer when their bounds change.

No Leaflet, external imagery tiles, style selector, or private Leaflet method adapter remains. Old scenario imagery fields can still be read, but new scenarios always use Atlas. Geographic resolution and grid density remain separate settings: all three Natural Earth resolutions, cities, country rasters, and editor geometry are still needed.

## Rendering and ownership

PixiJS is loaded on demand and uses WebGL. The political view retains country polygons in zoom-zero world coordinates, transforms the world containers with the camera, and retains GPU flag sprites for visible units. Dirty ownership cells invalidate neighboring world chunks; zoom and pan do not rebuild country geometry. Scene retention is bounded, and scene objects remain entirely outside saveable simulation state.

The ocean and neutral coastline are behind the GPU country layer. Independently cached Canvas layers keep text, flags on countries, selection contours, naval icons, battle indicators, diagnostics, and editor overlays. Flag view, recording/export capture, initialization, and devices without WebGL use the complete Canvas path. This is a deliberate hybrid migration, not a claim that every drawing command now executes in WebGL. Pixi's CSP-safe uniform/shader adapters are included; `unsafe-eval` permission is not required.

During pan and zoom, both GPU and Canvas surfaces move as buffered compositor images. Coverage refills are throttled and gesture settlement paints the complete final view; ordinary gesture frames do not resubmit the GPU scenes or resize unit sprites. Refilled coast masks reuse their canvas and texture. Pointer coordinates use one layout read per sample, and the coordinate HUD writes at most once per animation frame.

The browser simulation worker is authoritative by default; the optional test-server owner runs the same simulation core. Recruitment, diplomacy, editing, and ownership handoffs retain the existing acknowledged protocol. Simulation algorithms, save formats, country identities, and geography assets are not rewritten here. AI targeting and proposal scheduling remain separate measured optimization work described in `PERFORMANCE-AUDIT.md`.

## Validation boundary

The automated Node suite covers: projection round trips, cursor anchoring, pointer coalescing/cancellation, editor ownership, camera resets and bounds, retained meshes, dirty-cell invalidation, scenario/save compatibility, actual worker messages, pause/speed changes, UI module wiring, complete module linking, and production/offline asset resolution under a GitHub Pages project subpath.

The CPU scene benchmark measures preparation and cache reuse, not WebGL drawing or browser FPS. The original whole-world Canvas command benchmark and new retained-scene benchmark exercise different work: the latter deliberately reuses prepared geometry. Their timings are not an end-to-end speedup ratio.

Browser checks complement the Node suite; recent campaign/UI validation is recorded in [the campaign guide](CAMPAIGN-GUIDE.md) and [AI planning notes](CAMPAIGN-AI.md). Headless viewport checks do not replace physical Mac/Android testing. Release validation should cover dragging and pinch across bounds, country gradients/coast clipping, flags and naval markers, editor image handles and painted terrain, capture/recording, WebGL context restoration/fallback, and offline startup on the actual deployment origin.
