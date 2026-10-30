# Campaign AI component comparison

Measured on 2026-10-29. Baseline: release commit `faac58f` (`0.29.0`).
Candidate: `feature/campaign-ai-planning`, `0.30.0-experimental.1`.
Node v24.15.0 on Linux, Intel Xeon E5-2690 v2. This is a shared development
host, not a Mac or Android device.

## Method

Ran `scripts/profile-campaign.mjs` three times per revision, sequentially in
alternating baseline/candidate order. Both used the same defaults, compiled
Ukraine 2023 input and deterministic initial placement: 1,200 formations,
2,880,000 cells, 30 warmup operations, 300 measured campaign periods and 100
measured snapshots per phase. Browser validation started after measurement.

Map SHA-256: `6c3bd474fe7a8717601881303c4a4bf176c508ed2679467e8f675e09ffa2fdab`.

Each cell below is the median of the three run-level means or p95s, in
milliseconds. It is not a pooled percentile or a statistical confidence interval.

| Operation | 0.29.0 mean | 0.29.0 p95 | Planner mean | Planner p95 |
| --- | ---: | ---: | ---: | ---: |
| Campaign period, automation off | 0.886 | 1.213 | 0.919 | 1.281 |
| Campaign period, automation on | 0.934 | 1.239 | 0.996 | 1.335 |
| Unchanged campaign snapshot | 1.544 | 2.234 | 1.305 | 1.744 |
| Changing-reserve snapshot | 1.537 | 2.222 | 1.765 | 3.055 |
| Forced-command snapshot | 1.906 | 2.295 | 1.954 | 2.423 |

The automated campaign-period median mean increased by approximately 0.062 ms
in this fixture, remaining about one millisecond per scheduled logistics cycle
(120 logical simulation ticks). This is component work, not the duration of a
whole simulation tick, browser frame or network round trip.

## Behavior and limits

The initial workload matches, but automation intentionally evolves it differently:
the old planner finished with 1,314 formations, the new one with 1,251 in each
repeat. Snapshot phases therefore do **not** compare identical final armies.
These measurements describe the cost of the new behavior, not a demonstrated
rendering speedup. Do not infer phone FPS, battery use, complete war balance or
long-session memory from these results. This harness has fixed territory and
omits combat, administrative polling, rendering and network transfer.

Full owner campaign JSON was 42,030 bytes before and 43,488 bytes after. The new
owner state includes planner history, which presentation snapshots omit; these
sizes are neither packet sizes nor compressed network traffic. Unchanged data
was published once and changing-reserve data five times per 130 snapshot calls
including warmup, on both revisions. Forced-command publication is intentionally
an excessive stress case. Timing tails on this shared host varied between runs.

## Reproduce

Run the following from separate baseline and candidate checkouts with the same
Node version and locked dependencies, while keeping other measurement workloads
idle. Give each run a different output directory.

```sh
node scripts/profile-campaign.mjs --outdir performance-results/campaign-ai/run-1
```

Ignored raw reports from this session are under
`performance-results/campaign-ai/baseline-{1,2,3}/report.json` and
`performance-results/campaign-ai/planner-{1,2,3}/report.json`.
An earlier exploratory baseline is excluded from this table.
