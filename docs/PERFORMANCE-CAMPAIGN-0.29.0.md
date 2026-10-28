# Campaign component measurements — 0.29.0

Measured on 2026-10-28 at 20:29 UTC using Node v24.15.0 on a Linux host with an Intel Xeon E5-2690 v2 CPU. These are Node component timings. They do not measure browser FPS, Android performance, network latency, or a complete game tick.

## Reproduce

```sh
node scripts/profile-campaign.mjs --outdir performance-results/campaign-0.29.0
```

The script reads the packaged `assets/maps/compiled/ukraine-2023-v3.mwsc.gz`, creates deterministic synthetic formations, and writes `report.json`. It does not modify a running game or build output. Run `node scripts/profile-campaign.mjs --help` for workload options.

The measured map SHA-256 was `6c3bd474fe7a8717601881303c4a4bf176c508ed2679467e8f675e09ffa2fdab`. The workload used:

- Ukraine and Russia at a 0.15-degree grid resolution: 2,880,000 grid cells.
- 600 formations per side initially, representing 1.2 million fictional deployed personnel in total. This synthetic workload differs from the scenario's normal starting deployment.
- 88 campaign cities out of 560 map cities.
- 30 warmup operations per phase, 300 measured economy periods, and 100 measured snapshots per snapshot phase.
- Fixed territory, no combat, no rendering, no network, and no administrative-region event polling.

## Results

| Operation | Mean, ms | p95, ms | Maximum, ms |
| --- | ---: | ---: | ---: |
| Campaign period, automation off | 0.823 | 1.209 | 3.565 |
| Campaign period, automation on | 0.874 | 1.158 | 1.632 |
| Snapshot, campaign omitted | 1.411 | 1.997 | 2.273 |
| Snapshot, unchanged campaign | 1.357 | 1.740 | 1.985 |
| Snapshot, reserve changes every call | 1.573 | 2.099 | 7.761 |
| Snapshot, forced command update every call | 2.002 | 2.458 | 6.808 |

Initial campaign construction took **5.908 ms** in this run; source-profile lookup was performed before that timer. A campaign period runs once per 120 logical simulation ticks. AI decisions are bounded to eight countries every four periods. Cached formation modifiers avoid scanning countries in each unit's combat update.

Both countries could recover supply and train during the automation phase: Russia ended with 655 formations and Ukraine with 659. The final 1,314 formations were identical across all four snapshot phases.

## Publication budget

Each snapshot probe advances two logical ticks, modeling 30 snapshots per logical second at speed 1. Reserve changes also update the corresponding side totals.

Campaign publication is limited to once per **60 logical ticks**, with immediate publication checks after a command or a new journal event. Higher game speeds reach this tick budget sooner in wall-clock time.

Across 130 calls including warmup:

- Unchanged campaign data was published once.
- Continually changing reserves caused five campaign publications.
- Artificially forcing a command revision on every call caused 130 publications.

The final campaign JSON was **42,030 bytes**. This is an uncompressed JSON size, not measured WebSocket traffic. Whole snapshots contain other state as well.

## Interpretation and limits

The new economy update costs about one millisecond per scheduled period in this workload. Serialization of frequent changes is more relevant than the economy's average per-tick cost, so campaign publication has a separate budget. Commands and journal changes remain responsive.

This is one run on a shared development host. Garbage collection and concurrent processes affect maxima; the slightly lower unchanged-campaign result does not establish a speedup. Warmup and phases share state, and automation changes the army between the economy phases. The forced-command phase is a stress probe rather than ordinary player behavior.

The benchmark uses the same simulation modules as the game but does not run the full simulation tick, region polling, browser rendering, worker message transfer, or server transport. It cannot determine the end-to-end cost of a campaign on the user's Mac or Android device. The pinned device benchmark deliberately disables campaign mechanics to retain its earlier workload. For campaign comparisons, profile normal play with identical scenarios, viewport, settings and war duration; do not treat the pinned benchmark as a measurement of these mechanics.
