# Forces, economy, events and country relationships

Research and design proposal, 2026-10-28. The server-mode feature flag is implemented
separately in `0.28.7-server.3`. The first playable implementation is now in `0.29.0-experimental.1` on
`feature/forces-economy-events`; see [the campaign guide](CAMPAIGN-GUIDE.md).
The design below remains the broader roadmap, not a claim of full real-world
inventory coverage or a detailed logistics/air-war simulation.

## Existing foundation

- A flag represents a formation with actual personnel, not one soldier or vehicle.
  `army-formation.js` currently creates `kind: "army"`; `formation-strength.js`
  tracks personnel, capacity and strength. Nominal size defaults to 1,000 personnel
  but may grow to keep the number of moving formations bounded.
- Population/GDP/territory influence initial manpower estimates. Reserves,
  automatic wartime recruitment, city effects and an early mobilization multiplier
  exist in `war-start.js` and `simulation-tick.js`. These are game rules, not a
  dated military inventory or a treasury/production economy.
- Mountain troops, maritime invasion/supply behavior and generic missiles exist.
  There is no complete branch model for armor, artillery, aviation, air defense
  or unmanned systems. Missiles currently use generic launch and impact rules.
- `countryMetadata.overlordId`, diplomatic vassalization and the inspector already
  represent game dependencies. Scenario export/load retains the relationship.
- Simulation events already convey capitulation, treaties and map changes.
  A general event journal and region-capture notifications are absent.
- Administrative boundaries are a display overlay. They are not simulation
  provinces; the generated `provinceMap` is not a reliable oblast-control index.

## Player-facing force model

Use **armed forces** for a country's whole force and **formations** for map markers.
Expose three separate ledgers:

1. Personnel: available recruits, training, deployed personnel and reserves.
2. Equipment: stored, serviceable, assigned, under repair and on order.
3. Consumables: ammunition and expendable systems, with replenishment queues.

Show formation role, personnel and assigned equipment in the inspector. A country
panel summarizes totals and lets the player choose recruitment/production priorities.
Keep factual source observations separate from the playable starting allocation.

| Category | Proposed game representation |
| --- | --- |
| Infantry | Formation personnel, training and equipment allocation |
| Armor/mechanized forces | Armored formation composition and equipment pool |
| Artillery | Support capacity, ammunition use and supply requirements |
| Air defense | Aggregated defensive coverage/interception missions |
| Aviation | Aircraft readiness pools, crews and mission allocations |
| Unmanned systems | Separate reconnaissance, reusable strike and expendable attack categories |
| Missiles | Consumable inventory and abstract strike missions |
| Navy | Later fleet pools building on existing maritime logistics |

These are game roles with documented balance parameters. Country inventory totals
alone cannot determine effectiveness. Do not create one simulation agent per tank,
aircraft or drone: retain bounded formations and aggregated missions. Stock and
production differences can distinguish countries without multiplying moving objects.

Changes to force mix consume resources and time. Demobilization releases surviving
personnel/equipment according to explicit rules; a slider must not instantly turn
infantry into aircraft. Player overrides remain available in scenario setup/editor
and are labeled as customization rather than sourced historical values.

## A small city economy

Start with one treasury per country, income, upkeep and a limited construction and
training queue. City development can add income, industrial capacity, training
capacity or supply storage. Construction consumes budget and takes game time;
maintenance and repairs compete with new production.

Recruitment requires **people + funding + equipment + training time**. It adds
personnel to bounded formations or creates a formation when the marker budget
allows. Money alone must not produce unlimited flags. Mobilization temporarily
expands the available manpower/training pool with a documented economic trade-off;
it does not automatically create tanks, aircraft or trained crews.

AI countries use the same treasury, costs, limits and queues. Budget allocation and
building decisions run at coarse logical intervals rather than every simulation
tick. GDP may seed an explicitly fictional income scale; it is not directly the
government budget, industrial output or cash available for purchasing equipment.

Keep national aggregate source data separate from city allocations: assigning
national production to particular cities is a scenario/game rule unless separately
sourced. The initial implementation does not require real industrial-site locations.

## Events that explain the game

Add a bounded, localized journal and optional short notifications:

- City/capital captured or liberated; capitulation and treaty outcomes.
- Mobilization started/ended; training and construction completed.
- Equipment shortages, insufficient maintenance budget and changed dependency.
- Region becomes contested or passes a defined control threshold.

The simulation owner emits stable event IDs, logical ticks and structured payloads;
the browser translates and presents them. Deduplicate delivery and group repeated
events, retain only a bounded recent history, and allow notification filters.

For oblasts, precompute cell-to-administrative-region membership and maintain
control counts from dirty territory cells. Specify contested/majority/full-control
states and threshold hysteresis before using the label "captured". Do not scan all
regions each tick or announce a whole oblast when one cell changes owner. Preserve
the distinction between military control and sovereign ownership.

## Data sources and limits

No single complete, current, openly reusable inventory API was established by this
research. Prefer a reproducible offline import of explicitly dated public data,
then serve compact versioned assets with the game. Start with a small verified
country set; expand coverage only when definitions and reuse conditions are clear.

| Source | Useful coverage | Limits and reuse considerations |
| --- | --- | --- |
| [World Bank API](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392) and [personnel metadata](https://databank.worldbank.org/metadataglossary/world-development-indicators/series/MS.MIL.TOTL.P1) | API v2; population, GDP and historical aggregate personnel | Personnel metadata currently covers 1985–2020 and includes active military plus qualifying active paramilitary, excluding reserves. It is not infantry strength or a 2026 count. This indicator is CC BY-4.0; preserve attribution and check each series. |
| [SIPRI military expenditure](https://www.sipri.org/databases/milex) | Annual country spending series, Excel, through 2025 | Spending is not equipment stock or combat strength. Commercial reuse requires authorization/licensing under its published terms. |
| [UNROCA reporting cycle 2026](https://unodaweb.unoda.org/public/2026-02/Note-verbale-UNROCA-Reporting-Cycle-2026.pdf) | National reporting on conventional arms transfers; optional holdings and domestic production | The cycle concerns 2025 observations. Holdings reporting is voluntary and incomplete; absent values are not zero. Check reuse terms before redistribution. |
| [UK MOD equipment and formations 2026](https://www.gov.uk/government/statistics/uk-armed-forces-equipment-and-formations-2026) | A national example with aircraft, land equipment, vessels and formation tables in Excel/ODS | Published 2026-08-20, observed 2026-04-01; category definitions matter. GOV.UK states OGL v3 except where otherwise indicated. Other countries require their own sources. |
| [FlightGlobal World Air Forces 2026](https://www.flightglobal.com/download?ac=113851) | Publicly advertised country aviation survey | Download returned 403 during research; no data was imported. Public reading access is not an open license to redistribute the underlying database. |
| [IISS Military Balance+](https://www.iiss.org/the-military-balance-plus/) | Broad military personnel/equipment coverage | A commercial licensed product, not an assumed free API. |

[SIPRI arms transfers](https://armstransfers.sipri.org/) may provide historical
delivery context, but deliveries do not equal today's holdings: losses, retirement
and domestic production must be considered. Its TIV measure is not a procurement
price and must not become a literal purchase cost in the economy.

For each observation store country ID, category, value or range, measurement unit,
status (active/reserve/stored/ordered), observation date, publication date, source
URL, license, definition and confidence/uncertainty. Keep `null`/unknown distinct
from zero. Label a fallback as a game assumption. Do not infer missing drone or
missile stocks from the number of attacks reported in news.

Choose a data snapshot appropriate to the scenario date: Ukraine 2023 must not
silently inherit 2026 observations. Preserve provenance when values are customized.

## Dependencies and political relationships

Keep these separate: sovereign ownership, military control, alliances, formal
administrative dependencies, and player-created game vassalage. An alliance or
arms supplier does not by itself establish control over another country.

Reuse `overlordId` for the game mechanic, while sourced starting relationships need
a typed record with dates and evidence. The [UN list of Non-Self-Governing Territories](https://www.un.org/dppa/decolonization/en/nsgt)
describes a specific territory/administering-power category, not a global list of
"puppet states" or every dependency. Historical datasets also have cutoffs; for
example, [COW colonial/dependency contiguity](https://correlatesofwar.org/data-sets/colonial-dependency-contiguity/)
ends in 2016 and measures geographic contiguity, not current political influence.

Use a concrete sourced label for starting real-world relationships. "Game vassal"
can describe a dependency created during play or explicitly defined by a scenario
author. Contested political assessments should not be imported as objective flags.

## Suggested delivery order

1. Clarify existing formation/personnel labels and add the bounded event journal,
   reusing capitulation/treaty hooks and adding city/mobilization events. Profile mobile
   overhead and expose actual simulation and paint rates in diagnostics.
2. Add dated country force profiles and the force-composition UI. Keep imported
   observations, playable defaults and player overrides distinct; start with a
   small verified source set and migration/round-trip checks.
3. Introduce city income, construction/training queues and AI budget decisions,
   then infantry/armor/artillery role mechanics. Cover budget conservation,
   resource exhaustion, demobilization and bounded formation counts.
4. Add aggregated aviation, air defense, unmanned systems and missile missions,
   measuring CPU/memory before increasing workload. Add oblast control events
   after a proper administrative cell index exists.
5. Enrich typed political relationships and scenario dependency displays, reusing
   existing game vassalage and preserving sourced provenance.

Cross-cutting requirements: the simulation owner owns all new state, queues and
events; browser and server must follow the same rules. Country/city export fields
are currently explicitly selected, and unit snapshots pack a fixed field list.
Extend the loader, scenario export/compiler, migrations, restart/handoff handling
and versioned snapshot protocol together. Old scenarios need safe defaults and
must continue to load. Keep economy/event scheduling coarse and data structures
bounded given the measured Android limitations.
