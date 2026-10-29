# Campaign: forces, economy and events

Published version: `0.29.0`. Development: `0.30.0-experimental.1` on
`feature/campaign-ai-planning`; see [campaign AI planning](CAMPAIGN-AI.md).

Start a normal scenario, choose opposing countries and start the war. Open the
map menu and choose **Forces & economy**. The browser worker remains the default;
the Advanced settings server-simulation flag opts into an isolated server
owner only on a deployment that provides the prototype backend. The public
Docker release is browser-only. Both owners execute the same campaign rules.

Open **Menu → How to play** for the in-game guide, available in English, Ukrainian and
Russian. It covers setup and the campaign controls below. Opening help preserves
the selected scenario and countries; during a battle it starts at the combat
section. Campaign pages include a shortcut to the relevant controls. When Forces
& economy is open, the same guide appears inside it and can be collapsed; closing
the panel restores the guide on the map at the same page. Opening a section does
not place an order. Help does not pause the simulation, so use Pause first to read
at leisure.

## Playing

- Select an active country. This is a sandbox/observer game: the selector can
  manage either side, rather than assigning a player account to a nation.
- **Forces:** distinguish formations, deployed personnel, reserves, stock and
  equipment already assigned to formations. Infantry, armor, artillery and air
  defense have different costs, upkeep, combat and movement modifiers. One flag
  remains an aggregate formation, not one vehicle or soldier.
- **Management:** use city income to fund training, equipment production and
  economy, industry, training or supply buildings. Orders reserve their costs
  immediately, finish over logical simulation periods and can be cancelled.
  Capturing a city transfers its buildings; ownership and budget are checked by
  the simulation owner, not by the displayed button state.
- **Mobilization and policy:** mobilization moves a bounded civilian pool into
  reserves at a cost to civilian income. Demobilization returns a formation's
  surviving personnel and assigned equipment. Economic, balanced, offensive and
  defensive policies change game modifiers. Disable country automation to
  control spending yourself; automated countries use the same commands and
  budgets.
- **Operations:** aircraft and reconnaissance drones are reusable mission
  resources; strike drones and missiles are expended. Enemy air defense reduces
  effectiveness. These are aggregate game effects, not flight/pathfinding or
  targeting simulations. Missile/drone flights are bounded visual effects;
  damage is not applied a second time on visual impact.
- **Journal:** filter a bounded history of training, construction, mobilization,
  missions, city/capital captures, capitulation and relationship changes. Ukraine
  also has oblast control notifications. Majority control and full control are
  different states; sparse periodic checks can delay a notification. Turn off
  event popups without losing the journal.

The simulation continues while the campaign panel is open unless paused using
the normal controls. A game period is 120 logical ticks, not a calendar month.

## Country automation in the development build

Country automation plans spending, training and operations from game resources.
The Overview tab shows its **last decision**, the reason and the cycle when it
was made. A waiting state can mean saving funds, a full queue, missing equipment,
a formation limit or no suitable hostile target. This explanation is historical;
it is not a promise that the same action remains appropriate after the map changes.

Turn off the automation checkbox in Recruitment & cities and press **Apply**
under Country strategy to manage new orders yourself. Existing paid orders and missions keep progressing. The planner respects
the selected policy and uses the same command validation and resources as the
player. It does not learn between games or consult an external AI service.

## Public observations versus game balance

The source section presents dated public aggregates, including historical World
Bank personnel estimates and a limited UK Ministry of Defence equipment sample.
It selects observations no later than the scenario date. Each available record
includes its observation date, source and license. Unknown values stay unknown.
Total aircraft, armored vehicles and UAV systems do not mean combat-ready
fighters, tanks or individual drones.

Game stocks, prices, formation role mix, income and mobilization are explicitly
fictional balance parameters. They scale with the scenario and can be overridden
in scenario `forceProfile.gameAssumptions`; sourced totals are not automatically
converted to deployable formations. Coverage is intentionally partial; there is
no claim of complete current inventories for every country. See
[asset provenance](../assets/data/forces/README.md).

Country relationships distinguish sourced formal constitutional relationships
from `overlordId` game vassalage. A game relationship is not evidence that a real
country is a puppet state. Imported `forceProfile`, `dependency` and stable ISO
identity survive scenario export/import. Scenario export is not a live save.

## Ownership and performance

`campaign-core.js` owns budget, recruitment, missions and queues.
`campaign-events.js` owns bounded event history and sparse region checks.
`campaign-ui.js` reads mirrors and submits acknowledged commands. Campaign data
survives the full worker handoff used for editing and diplomacy. Presentation
snapshots omit region cell membership and internal event baselines. Role
modifiers are cached and periodic campaign work does not spawn one object per
vehicle. Legacy free recruitment and random missile spawning are disabled only
when a campaign is enabled.

The pinned performance benchmark explicitly disables campaign mechanics to keep
its previous workload comparable. Measure normal campaign games separately; a
passing smoke test does not establish phone FPS or long-session memory behavior.

There are no accounts, multiplayer rooms, database saves or reconnect recovery.
Closing/reloading the game loses the current campaign, as in the base game.
Language and feature preferences retain their existing local persistence. The
completed campaign journal and final formation totals remain available from the
setup screen until another war or scenario replaces them.

## Validation and isolated preview

```sh
node scripts/campaign-core-smoke.mjs
node scripts/campaign-data-smoke.mjs
node scripts/campaign-ui-smoke.mjs
node scripts/campaign-integration-smoke.mjs
node scripts/import-force-profiles.mjs --check
npm run typecheck
npm run lint
npm run smoke
npm run build -- --outDir /tmp/moder-wars-campaign/dist
MW_BUILD_DIR=/tmp/moder-wars-campaign/dist node scripts/build-output-smoke.mjs
MW_STATIC_DIR=/tmp/moder-wars-campaign/dist MW_HOST=192.168.31.224 MW_PORT=4180 npm run prototype:server
```

Use an isolated output directory and **port 4180** for the single test server.
As of 2026-10-29 it serves 0.30.0-experimental.1 from
`/tmp/moder-wars-test-4180/dist`, using matching protocol-4 server code under
`/tmp/moder-wars-test-4180/source`. Other persistent game previews are stopped.
Docker is production and stays on 0.29.0 until an explicit release. Do not mix
server/client protocol versions.

Component CPU measurements and their limits are recorded in
[the campaign performance report](PERFORMANCE-CAMPAIGN-0.29.0.md).

### Verification recorded on 2026-10-29

- TypeScript, Biome, tutorial, FFA setup, UI, i18n, module-graph and isolated
  build/output checks passed.
- Chromium reproduced the Ukrainian setup overflow (505 px of content in a
  458 px panel) and verified the corrected layout at 1280, 970, 480, 390 and
  320 px viewport widths, including expanded country controls, four sides and FFA.
- All 13 help pages were navigable in English, Ukrainian and Russian. Narrow
  viewports down to 320 × 480 kept the navigation visible and scrolled the body.
  Help preserved the selected Ukraine/Russia scenario and a paused live campaign.
- For experimental.3, Chromium checked the HUD menu and country inspector in
  narrow viewports and editor mode. Menu actions stayed within the viewport;
  country action rows wrapped and the close control remained reachable.
- The native campaign dialog kept the actual tutorial controls accessible. At
  320 × 480, the finance shortcut opened Recruitment & cities, focused the role
  selector and preserved step 8; the expanded guide retained 164 px for its text.
  Keyboard navigation, Escape restoration and Finish focus passed in the tested
  English, Ukrainian and Russian flows.
- These are automated viewport checks, not measurements on Mac or Android hardware.

### Verification recorded on 2026-10-28

- TypeScript, Biome, the full smoke suite and isolated build/output checks passed.
- Real Chromium exercised normal Ukraine 2023 startup, browser-owned training,
  construction, production, mobilization, policy and reconnaissance commands,
  their acknowledgements and journal entries while paused.
- Real Chromium with the WebSocket owner accepted training for Ukraine and
  rejected another country's training at its formation cap with a visible reason.
- At 390 × 844, the Ukrainian panel remained within the viewport and the map menu
  could open it after correcting overlap with the mobile war overview. Desktop
  checks used 1280 × 720. This was viewport testing, not an Android hardware run.
- The existing optional secret-audio 404s, missing favicon and CSP-meta warning
  were still present in the preview console; no campaign runtime exception was
  observed in these flows.

Local screenshots are under `output/playwright/campaign-*` and
`output/playwright/panels-*` (ignored by Git).
