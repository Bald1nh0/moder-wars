# Performance and backend backlog

Recorded on 2026-10-28. Persistence and production backend work remain proposals. An isolated server-simulation prototype was approved after release measurements; see [prototype instructions](SERVER-SIMULATION-PROTOTYPE.md).

The [post-prototype research](PERFORMANCE-NEXT-STEPS.md) ranks the next experiments and explains why extra compression, Redis, or a backend-language rewrite are not assumed speedups.

## Gameplay proposals

The [forces, economy, events and relationships proposal](GAMEPLAY-EXPANSION.md)
records the player's ideas, existing mechanics, source limitations and delivery order.

- [ ] Clarify formations versus personnel/equipment and add dated country force profiles with source attribution and editable game defaults.
- [ ] Add a bounded event journal for cities, capitulation and mobilization; add region-control notifications after administrative cell indexing.
- [ ] Add city income, upkeep, construction/training queues and AI budgets using the same rules as the player.
- [ ] Introduce distinct force roles and aggregated air/air-defense/unmanned/missile capabilities without one agent per vehicle or projectile inventory item.
- [ ] Extend typed country relationships using existing vassalage; keep sourced dependencies separate from alliances, occupation and scenario-created control.

These are proposals, not implemented inventory imports or economy mechanics.

## Decision baseline

- [x] Measure the released 0.28.6 build: scenario loading, simulation startup and execution mode, main-thread stalls, rendering, simulation tick distributions, and memory. See the [CPU baseline](PERFORMANCE-0.28.6.md) and [browser observations](PERFORMANCE-BROWSER-0.28.6.md) for measurement limits.
- [x] Separate browser observations from CPU simulation, pathfinding, frontier scans, snapshot transport, and loading. Record hardware, settings, scenario hashes, units, sampling overhead, and repeat counts. Software-rendered browser results do not isolate physical GPU performance.
- [x] Collect an initial real Mac browser/server pair; see the [Mac comparison](PERFORMANCE-MAC-0.28.7-server.2.md). Local worker startup succeeded; browser simulation sustained about 60 ticks/s versus about 28 on this server.
- [x] Collect an initial real Android browser/server pair; see the [Android comparison](PERFORMANCE-ANDROID-0.28.7-server.2.md). Both owners sustain about 33 ticks/s; application paints are less frequent remotely (10.3/s versus 14.5/s locally).
- [ ] Repeat both device pairs with similar temperature/background load. Single runs do not establish small gains or thermal/battery effects.
- [ ] Show observed simulation ticks/s, logical pace and actual render-call rate separately from animation-loop cadence; the existing FPS verdict can pass while server game time runs slowly.

The [0.28.6 browser observations](PERFORMANCE-BROWSER-0.28.6.md) reproduced a world-map worker startup timeout and substantial main-thread stalls. Prioritize tracing worker startup and measuring aggregate memory before assuming that persistence or a database will improve gameplay. The Eurasia run successfully used its worker, so this is not a universal worker failure.

### Proposed next iteration from the measurements

1. **Worker startup and memory:** trace world-map INIT through READY, explain the repeated five-second timeout, and measure state ownership/copies on actual devices. Acceptance: reliable worker startup on representative scenarios without hiding failures behind an arbitrary timeout increase.
2. **Navigation and periodic stalls:** investigate route-field/cache work and incremental or budgeted frontier updates. The current large-war CPU profile puts navigation ahead of the old audit's priorities; separate detailed timing attributes large periodic stalls to frontier work. Acceptance: improved mean and P95/P99 tick times on identical saved workloads without gameplay regressions.
3. **Presentation transport:** examine snapshot packing and application before assuming that the current in-process protocol can simply become a network protocol. Keep measured payload bytes distinct from actual wire bandwidth.
4. **Backend feature decision:** retain persistence/server simulation as options for cross-device saves or shared sessions. Do not provision a database as a performance fix for these observed bottlenecks.

These priorities are recommendations; the measurement task did not implement application optimizations or a backend. The subsequent experimental branch now tests Option C.

## Option A: improve the browser simulation

Recommended first when the objective is smoother single-player gameplay.

- [ ] Prioritize current measured hotspots; verify worker startup and any local fallback before changing architecture.
- [ ] Evaluate incremental frontiers, bounded AI queries/planning, and smaller presentation updates where current profiles justify them.
- [ ] Profile mobile rendering layers, labels and effects: the supplied Android pair spent approximately 46–57 ms per rendered frame in both owner modes. Evaluate presentation changes separately from simulation throughput.
- [ ] Implement genuinely smaller regional grids with explicit origins/extents. The current Eurasian theater masks land but retains global arrays. Preserve coordinate conversion, pathfinding, naval movement, exports, imports, and restarts.
- [ ] Compare identical workloads before and after each change; retain offline play.

## Option B: backend persistence

Purpose: profiles, synchronized preferences, saved games, scenario metadata, and results. Persistence alone is not expected to improve simulation ticks or map FPS.

- [ ] Consider Node.js/TypeScript and PostgreSQL for a multi-user service; SQLite is a simpler alternative for an explicitly single-instance prototype.
- [ ] Keep user/session ownership explicit. Version save formats and test restore, migrations, backups, and isolation between users.
- [ ] Use relational fields for identities and ownership, JSONB for flexible settings/metadata, and compressed snapshot files or blobs for large game grids. Do not store every cell movement as a database write.
- [ ] Retain local preference behavior and distinguish local saves from account-synchronized saves in the UI.

## Option C: server-owned simulation

Purpose: reduce client CPU work, support shared multiplayer sessions, and optionally continue a game after its browser disconnects.

- [x] Prototype the existing browser-free simulation core on Node.js with isolated workers and bounded sessions. This is a LAN experiment, not a production multiplayer service.
- [ ] Use WebSocket commands and incremental presentation snapshots. Keep active simulation state in server memory and persist periodic checkpoints plus necessary commands, not every tick.
- [ ] Define server authority, validated commands, ordering, reconnect/resynchronization, pause/disconnect policy, session lifetime, and recovery after process failure.
- [ ] Measure network latency/bandwidth, CPU/RAM per session, client rendering cost, and feasible concurrent sessions before selecting hosting capacity.
- [ ] Evaluate authentication, room permissions, rate limits, logs, metrics, and failure isolation before public multiplayer use.

This option still requires client map rendering and a reliable connection. It adds operating cost and does not by itself fix GPU/browser-memory problems. Do not add Redis, PostGIS, or additional services without a measured or functional need.

## Decision gates

1. Review the current release measurements and distinguish measured results from hypotheses.
2. Choose browser optimization for local CPU/render bottlenecks, persistence for cross-device saves, or server simulation for shared/continuous sessions.
3. Agree on the next implementation scope separately; retain the previous Docker image for rollback.

References: [existing CPU audit](PERFORMANCE-AUDIT.md), [PostgreSQL JSON types](https://www.postgresql.org/docs/current/datatype-json.html), [geographic scope constraints](GEOGRAPHIC-DATA.md).
