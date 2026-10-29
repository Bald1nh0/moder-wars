# Campaign AI planning

Development version: `0.30.0-experimental.1`, branch `feature/campaign-ai-planning`.
The published Docker playtest remains `0.29.0` until a separate release.

This is deterministic game AI, implemented in `src/campaign-ai.js` and called by
`campaign-core.js`. It uses game aggregates and ordinary campaign commands. It
has no learned model, external API, real-world targeting data or hidden resources.

## Decisions and resources

- Funding and physical supplies have separate ratios. A lack of money cannot by
  itself trigger construction of a supply building.
- The planner includes maintenance for queued formations and the proposed order.
  It projects eight logistics cycles ahead and normally protects four cycles of
  committed upkeep, with a minimum reserve of 120 game credits.
- Corrective construction can use that reserve when the remaining treasury can
  cover the wait until completion. Economy investments use construction cost,
  delay, income modifiers and payback; already queued buildings count toward
  levels and waiting time.
- New recruitment needs a sustainable projected income balance, available
  personnel, equipment, formation capacity and supply. Outstanding equipment
  production is respected instead of blindly issuing duplicate orders.
- Desired infantry, armor, artillery and air-defense shares depend on the
  selected policy, existing and queued formations, recent formation losses and
  hostile abstract air capabilities/missions. These are fictional balance
  heuristics, not real military doctrine or inventory estimates.
- Missions compare active hostile countries and available mission types using
  deployed strength, incoming missions, air defense, game effect and resource
  cost. Empty targets, allies, unavailable stock and disabled strike mechanics
  are excluded. Mission effects remain country-wide game modifiers.

The planner does not change the player's selected policy, cancel paid player
orders or forcibly demobilize formations. It cannot guarantee recovery from a
country with no funds and insufficient income to finance any corrective action.
That country reports the shortage rather than inventing money.

## Scheduling and ownership

Each country has its own next-decision deadline (normally four logistics cycles)
and economy/mission deadlines (twelve cycles after a successful respective
order). A rotating scheduler processes at most eight due countries in one
logistics cycle; large wars can therefore delay a decision. Availability depends
on elapsed deadlines, not matching a shared global cycle modulo.

This removes the previous 24-country scheduling trap: three fixed groups of
eight always ran at the same global cycle remainder, preventing some groups
from reaching economy or mission opportunities.

After two successful optional economy/mission actions, recruitment or equipment
production gets a turn before further optional spending. Urgent recovery keeps
priority. This prevents another starvation pattern at larger country counts.

Planner work uses country ledgers, bounded queues and aggregate roles instead
of scanning map cells or creating vehicle agents. The scheduler remains
deterministic across JSON/structured ownership handoffs. New entrants and older
states without planner metadata receive initial deadlines when needed.

`country.aiState` stores scheduling and small role-loss history on the owner.
Full state handoffs retain it; ordinary presentation snapshots omit it. The
bounded `country.aiDecision` contains the last action, reason, cycle and relevant
identifiers/budget estimate. Its localized display belongs to `campaign-ui.js`.
The presentation projection is built only when campaign publication is due.

Protocol version 4 requires matching browser/worker/server builds. The older
server preview must not be combined with this client to test the new rules.

## Reading the UI

Open **Forces & economy → Overview** and select a country. The decision card
shows what the AI last decided and when; map/resource changes can make that
explanation historical. Optional budget details show the estimate made at that
decision, not an account statement or guaranteed future balance.

Uncheck automation in Recruitment & cities and press **Apply** under Country
strategy to prevent new AI orders. Existing paid queues and missions
continue. Re-enabling it resumes decisions on the bounded scheduler. Completed
campaigns retain a historical explanation. English, Ukrainian and Russian are
supported, including waiting and manual-control states.

## Verification

```sh
node scripts/campaign-ai-smoke.mjs
node scripts/campaign-core-smoke.mjs
node scripts/campaign-ui-smoke.mjs
node scripts/campaign-integration-smoke.mjs
npm run typecheck
npm run lint
npm run smoke
npm run build -- --outDir /tmp/moder-wars-ai-preview/dist
MW_BUILD_DIR=/tmp/moder-wars-ai-preview/dist node scripts/build-output-smoke.mjs
```

The AI regressions use the production campaign implementation with deterministic
fixtures. They check resource constraints, composition changes, mission choice,
24/41/48/97-country scheduling, disabled/inactive countries, handoffs and long runs.
These checks do not establish full-combat balance or frame rate on a phone.

Component measurements and reproducibility limits are recorded in
[the comparison report](PERFORMANCE-CAMPAIGN-AI.md).

## Validation recorded on 2026-10-29

- TypeScript, Biome, the curated smoke suite, isolated production build and
  bundled-worker checks passed. After the final action-fairness change, campaign
  core/UI/integration checks and all 21 AI cases passed again.
- The new large-country tests include 24, 41, 48 and 97 participants. Disabling
  the discretionary-action guard in an isolated in-process mutation made the
  48/97-country recruitment-starvation cases fail, confirming the tests catch
  the intended fault.
- Headless Chromium started a real Ukraine 2023 campaign from the compiled build
  and displayed an actual cycle-4 construction decision and its budget estimate.
  Country switching and automation off/on with **Apply** worked while paused.
- The decision card rendered in English at 1280 × 720, Ukrainian at 390 × 844
  and Russian at 320 × 480. Expanded budget text had no horizontal overflow;
  the close button remained reachable by vertical scrolling at 320 × 480.
- Screenshots are in ignored `output/playwright/campaign-ai/`. These are viewport
  checks, not tests on physical Mac/Android hardware. Existing optional audio
  failures and CSP-meta warnings remain outside this change.
- The verified build was moved to the sole test port **4180**, with static files
  in `/tmp/moder-wars-test-4180/dist` and matching protocol-4 server source in
  `/tmp/moder-wars-test-4180/source`. Previews on 4173, 4175 and 4176 were stopped.
  Docker production remains 0.29.0.
