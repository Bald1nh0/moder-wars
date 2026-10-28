# Experimental campaign: forces, economy and events

Version: `0.29.0-experimental.1`. Branch: `feature/forces-economy-events`.

Start a normal scenario, choose opposing countries and start the war. Open the
map menu and choose **Forces & economy**. The browser worker remains the default;
the Advanced settings server-simulation flag still opts into an isolated server
owner. Both owners execute the same campaign rules.

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
MW_STATIC_DIR=/tmp/moder-wars-campaign/dist MW_HOST=192.168.31.224 MW_PORT=4182 npm run prototype:server
```

Use an unused port and an isolated output directory. The public Docker playtest
is deliberately unchanged. The prior server prototype is frozen at `3dad5ea`
with its own source snapshot and static build; do not mix protocol versions.

Component CPU measurements and their limits are recorded in
[the campaign performance report](PERFORMANCE-CAMPAIGN-0.29.0.md).

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

Local screenshots are under `output/playwright/campaign-*` (ignored by Git).
