# Modern Wars

A browser strategy sandbox on a real-world map. Choose countries and opposing
sides, start a war, and follow territorial control, formations, personnel and
casualties. Countries can fund recruitment, develop cities and conduct aggregate
air and drone operations; you can manage either side or watch their automation.

The game is under active development. Military stocks, prices and combat effects
are game-balance parameters. Dated public observations are shown separately and
do not represent complete current military inventories.

## Where to play

Play at **[modern-wars.bald1nh0.net](https://modern-wars.bald1nh0.net/)**.
Production uses a packaged Docker/Nginx image with browser simulation.

**4180 is the only local game test port.** Run the local preview when needed
for development checks. Shared testing uses the separate internal Docker
deployment: a successful push to `dev` updates it automatically. Editing source
or running a local test build does not deploy a release, and the dev deployment
cannot replace the production Compose project.
Vite uses a strict port, so an occupied port causes an error instead of opening
another preview. See [deployment setup](docs/DEPLOYMENT.md) for the automated
`main` → checks → image → production workflow and
[internal development deployment](docs/DEPLOYMENT-DEV.md) for the independent
`dev` workflow.

## Start a game

1. Select **Play**, choose a scenario and press **Start scenario**.
2. Select a side and click countries on the map to add them. Add more sides or
   enable **Free for all** if desired. Country cards expose extra options under
   **Configure**; conflict-wide options are under **Advanced Setup**.
3. Press **Start War**. Use Pause and the 1×, 2×, 3×, 5× or 10× speed selector.
4. Open **Menu → Forces & economy** to manage participating countries.
5. Open **Menu → How to play** for the 13-step game guide. It preserves the
   current map; campaign instructions remain usable inside Forces & economy.

Drag to pan; use the wheel/trackpad or touch pinch to zoom. Space pauses/resumes
outside form controls; + / − changes speed. Fullscreen is an explicit menu action.
Speeds are targets: a large war can reach the device's simulation limit.

**Menu → Main menu** asks before ending the session without saving. Cancelling
restores the previous pause state; confirming discards the battle. Help and the
campaign panel do not pause the war automatically.

## Scenarios and geography

| Scenario | Scope and data |
| --- | --- |
| **2026 Modern Day** | World political geography from the Overture Maps 2026-10-21 release, with a separate administrative-region overlay. No live-frontline reconstruction. [Sources and reproduction](assets/scenarios/modern-2026/README.md). |
| **Ukraine 2023 · Eurasia** | Eurasian theater with approximate control on 2023-01-01, using an independent reconstruction of attributed DeepState visual contours. Armies are fictional. [Sources and limitations](assets/scenarios/ukraine-2023/README.md). |

- **Settings → Display → Show regions / oblasts** controls the reference borders
  and zoom-dependent labels. These are not separate simulation provinces.
- The Ukraine scenario distinguishes sovereignty from military control and
  outlines/hatches occupied territory with controller labels.
- **Leaderboard** separates controlled territory cells, living formations and
  deployed personnel. Cells are not square kilometres; shared reserves are not
  counted as deployed troops.
- The built-in menu exposes the two scenarios above. Older datasets remain for
  compatibility and pinned benchmarks. Scenario editing/import/export code and
  God Mode tools remain available in the codebase; a scenario export is not a
  saved running campaign.

See [geographic data](docs/GEOGRAPHIC-DATA.md) and
[region attribution](assets/geodata/admin1/README.md) for coverage and licenses.

## Forces, economy and events

Available in production **0.29.0**:

- One flag represents an aggregate formation. Infantry, armor, artillery and
  air defense have different roles, costs and upkeep; personnel, reserves and
  equipment stocks are tracked separately.
- City income funds training, equipment production, and economy, industry,
  training and supply buildings. Queues consume resources and take game time.
- Country automation is enabled by default. It can train troops, build in
  cities, produce equipment and mobilize using the same resources as the player.
- Mobilization increases the recruitable reserve while reducing civilian income.
  Aircraft, reconnaissance drones, strike drones and missiles provide aggregate
  mission effects; individual vehicles and realistic flight paths are not simulated.
- The event journal records recruitment, construction, missions, captures and
  country events, including sparse oblast-control checks for Ukraine. Event
  popups can be disabled independently.

To manage a country's spending yourself, open **Recruitment & cities**, uncheck
**AI can train, build and produce using this country's resources**, then press
**Apply** under Country strategy. Existing paid orders continue.

See [the campaign guide](docs/CAMPAIGN-GUIDE.md) for controls and
[force-data provenance](assets/data/forces/README.md) for observation coverage.

### New in the 0.30.0 test build

The `feature/campaign-ai-planning` branch adds:

- Separate handling of cash shortfalls and physical supply shortages.
- Budget forecasts that include queued troops, future upkeep and a cash target.
- Recruitment based on force composition, losses and hostile air capabilities.
- Independent country deadlines and bounded scheduling without starving later
  countries or repeatedly postponing recruitment.
- Scored hostile targets and mission choices.
- **Forces & economy → Overview → AI decisions**: the last action, its reason,
  decision cycle and an optional budget estimate, in English, Ukrainian and Russian.

This is deterministic game AI with editable rules, not a model that learns
between games. See [AI behavior and verification](docs/CAMPAIGN-AI.md).

## Languages and session storage

Choose **Settings → Interface → Language**. English, Ukrainian and Russian cover
the current interface and campaign guide. Other languages retain partial
translations and fall back to English. Source dataset labels and user-authored
content may retain their original names.

Language is saved immediately in the `mw_lang` cookie for one year. Feature
preferences use browser-local storage; clearing site data removes them. Separate
browser sessions run independent games, even when using the same server.

There are no shared multiplayer rooms, persistent campaign saves or reconnect
recovery. Reloading or closing the game loses the current battle. Server mode
also discards its simulation when the connection closes.

## Run locally

Use **Node.js 24+** and npm; CI currently uses Node 26. Install locked dependencies:

```sh
npm ci --ignore-scripts
npm run dev
```

This starts the Vite development server at `http://127.0.0.1:4180/`. Coordinate
stopping/replacing any existing test server first. Serve the Vite build rather
than opening `index.html` directly; dependencies and workers need bundling.

For a static preview, prepare an isolated build and then use the same test port:

```sh
npm run build -- --outDir /tmp/moder-wars-preview/dist
npm run preview -- --outDir /tmp/moder-wars-preview/dist
```

A static Vite preview provides browser simulation only. For both simulation modes,
use matching source and build output with the Node test server instead:

```sh
MW_STATIC_DIR=/tmp/moder-wars-preview/dist \
  MW_HOST=127.0.0.1 MW_PORT=4180 npm run prototype:server
```

Only one of these servers should run at a time. The server prototype has no
public account/authentication layer and stays on the trusted LAN.

**Settings → Advanced → Server simulation (experimental)** opts into server
ownership for a new game; it does not migrate a running battle. Explicit
`?simulation=browser` and `?simulation=server` URLs override the saved preference.
The current test client and server use protocol 4 and must be updated together.
Production's static Docker image does not provide the optional backend.

[Server setup and device testing](docs/SERVER-SIMULATION-PROTOTYPE.md) covers the
separate performance-testing flag, downloadable reports and ownership limits.

## Verify changes

When no server uses `dist/`, `npm run check` runs TypeScript, Biome, Node smoke
tests, the build and emitted-asset/worker checks. To avoid replacing a live build:

```sh
npm run typecheck
npm run lint
npm run smoke
npm run build -- --outDir /tmp/moder-wars-validation
MW_BUILD_DIR=/tmp/moder-wars-validation node scripts/build-output-smoke.mjs
```

Individual checks use `node scripts/<name>-smoke.mjs`. Browser validation uses
the single 4180 test deployment; temporary integration-test listeners close when
their checks finish. Node tests verify simulation behavior and transport, while
browser checks verify layout and interactions. Neither establishes performance
on a physical phone without device measurements.

The simulation profiler and campaign component profiler are separate:

```sh
node scripts/profile-performance.mjs --help
node scripts/profile-campaign.mjs --help
```

Reports go into ignored `performance-results/`. The pinned legacy workload
intentionally disables campaign mechanics. Use comparable maps, settings and
builds when measuring normal campaign play. See the
[campaign AI comparison](docs/PERFORMANCE-CAMPAIGN-AI.md),
[earlier campaign measurements](docs/PERFORMANCE-CAMPAIGN-0.29.0.md) and
[optimization priorities](docs/PERFORMANCE-NEXT-STEPS.md).

## Docker production releases

The GitHub Actions workflow checks pull requests and pushes to `dev` and `main`.
A successful push to `dev` publishes and deploys the internal development image.
A successful push to `main` publishes the checked production image to GHCR,
deploys it using the dedicated runner, and publishes a matching GitHub Release
after health checks pass. No deployment enablement or hostname variables are
required. Manually dispatched runs check code without releasing it. The earlier
GitHub Pages workflow is replaced. [Upstream licensing clarification](https://github.com/Vaspyyy/moder-wars/issues/5)
remains separate from the deployment configuration.

- GitHub-hosted runners run TypeScript, lint, simulation/build checks, deployment
  regression tests, container health checks and an image vulnerability/secret scan.
- The Docker host pulls the exact published image digest; it does not build the
  application. Compose waits for health and restores the previous release if an
  upgrade fails. Container replacement can briefly interrupt HTTP requests.
- Nginx runs unprivileged with a read-only filesystem, temporary runtime storage,
  bounded logs and an HTTP health check. There are no source-directory mounts.
- The image contains static files only; the experimental Node simulation server
  remains a separate local testing option.

See **[deployment setup, release and rollback](docs/DEPLOYMENT.md)** for runner
registration, environment settings and reverse-proxy cutover. The pipeline must
be configured and merged before it can deploy; preparing these files does not
move the currently running production release.

`Dockerfile` copies an existing `dist/`; it does not compile the app.
`package.json` is the single source of the application version. Choose one bump
command for the release; the examples below each start from `0.30.0`:

```sh
# PATCH: compatible fixes, performance or security improvements (0.30.0 -> 0.30.1)
npm run version:bump -- patch

# MINOR: new features (0.30.0 -> 0.31.0)
npm run version:bump -- minor

# MAJOR: first stable release, then breaking public-contract changes (0.30.0 -> 1.0.0)
npm run version:bump -- major
```

Before `1.0.0`, use a minor bump for breaking changes and document migration.
The helper updates lockfile metadata automatically without committing or creating
Git tags. After the chosen bump, validate the synchronized metadata:

```sh
npm run version:check
```

Vite injects the version
into the menu/reports and generates the service-worker cache identifier.
The browser tab stays **Modern Wars**, with a shield-and-compass favicon.
Use numeric versions without prerelease suffixes on both branches; keep the same
application version when promoting tested dev changes to production. Dev images
are distinguished by commit/run tags. Update the changelog after a version bump.
`npm run version:check` validates package metadata. GitHub Release `vX.Y.Z` includes
a small image manifest; the Docker image itself is stored in GHCR. Registry
cleanup defaults to dry-run and preserves current/rollback images. Keep previous images
for rollback and do not restart production during ordinary development.

## Architecture and further reading

- **Runtime:** Vite, JavaScript simulation/UI, strict TypeScript camera/scene
  modules, and a resident simulation worker. Browser rendering uses state mirrors;
  editing and diplomacy request an acknowledged ownership handoff.
- **Rendering:** native Mercator camera, PixiJS WebGL country meshes/flags,
  cached Canvas overlays and Canvas fallback. Memory budgets limit rendering
  surfaces; geography resolution and simulation grid density are separate settings.
- **Data:** compiled MWSC v3 scenarios, backward-compatible v2 decoding and JSON
  scenario import/export. Higher-detail geography loads on demand. The service
  worker caches the built shell on secure origins; Vite development disables it.
- **Army AI:** front sectors, reserves, task forces, retreat and encirclement
  rules. **Settings → Display → Show Army Decisions** exposes its diagnostic overlay.

| Document | Purpose |
| --- | --- |
| [Changelog](CHANGELOG.md) | Release and development history |
| [Campaign guide](docs/CAMPAIGN-GUIDE.md) | Player controls, data and session limits |
| [Campaign AI](docs/CAMPAIGN-AI.md) | Planning rules, scheduling and tests |
| [Army AI](docs/army-ai.md) | Frontline command and navigation architecture |
| [Deployment](docs/DEPLOYMENT.md) | GitHub Actions, Docker releases and recovery |
| [Modernization](docs/MODERNIZATION.md) | Build, camera and rendering design |
| [Gameplay expansion](docs/GAMEPLAY-EXPANSION.md) | Feature design and scope |
| [Backlog](docs/BACKLOG.md) | Remaining gameplay, persistence and performance work |
| [Agent instructions](CLAUDE.md) | Repository working agreements; `AGENTS.md` links to this file |
