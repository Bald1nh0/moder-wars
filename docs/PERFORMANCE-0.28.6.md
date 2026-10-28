# Performance baseline: release 0.28.6

Measured on 2026-10-28 **after** deploying Docker `moder-wars:0.28.6-playtest`. The browser observations are recorded separately in [Browser observations: Docker 0.28.6](PERFORMANCE-BROWSER-0.28.6.md).

The current engine exceeds the 60 Hz simulation budget in the larger controlled wars. Even the lighter deployment has periodic long ticks. The current CPU sample highlights army navigation, formation updates, operational AI, and frontline rebuilds. Adding persistence alone would not address these measured costs.

## Scope and reproducibility

- Engine: current **0.28.6 working tree**, commit `acc5016` with uncommitted release changes. No simulation or rendering code was modified during measurement.
- Runtime source fingerprint: `7e911d0bab2feceaf33f7b5e0784bd80f3e5ca3ec93e54fe351d888f3af99528`. This SHA-256 covers sorted relative paths, a NUL separator, bytes, and a final NUL for all 137 `src/*.js`, `src/*.ts`, and `workers/*.js` files. The fingerprint was verified unchanged at completion.
- Released image: `sha256:87872b082f648801289516d9cae9168a5932f88d718cc2c575343a35047e6368`.
- Host: Intel Xeon E5-2690 v2 @ 3.00 GHz, 16 logical CPUs available, 31.39 GiB RAM, Linux `6.8.0-139-generic`, Node `v24.15.0`. This is the shared development host. Normal IDE/background services remained running; the initial 1/5/15-minute load averages were 1.82/1.73/1.25. Browser measurements and release builds had finished before CPU timing began.
- Geography: the profiler's **pinned 2022 fixture**, SHA-256 `a40b8db35255df20f78282cccda987b77e069c8fb67bd4d0e48d778156d268a1`, running on the current engine. These CPU cases do **not** measure the new 2026 or Eurasia scenario assets. Their actual load/startup/render paths were exercised in the browser report.
- Grid: explicit **0.1°**, matching the current default; 3,600 × 1,800 = **6,480,000 allocated cells**. The historical CLI default remains 0.15° and was not changed.
- Each timing workload uses three fresh processes, 300 untimed warm-up ticks and 600 measured ticks per process: 1,800 measured ticks per row. Deployment and random input are repeatable. Half the initial formations start at hostile borders and half inside their country. Recruitment/merging/casualties still operate, so live counts differ from initial deployment.
- Speed is 1×; missiles and peace treaties are disabled; terrain is flat. These are controlled stress fixtures that bypass normal menu deployment, not exact player sessions. Timing excludes loading, warm-up, rendering, and snapshot work. Instrumented diagnostics run separately.
- The previous [performance audit](PERFORMANCE-AUDIT.md) used different hardware, Node, code and grid/workloads. No before/after speedup is claimed.

## Simulation tick timings

A **60 Hz simulation tick budget is 16.67 ms**. These are CPU tick durations, **not browser FPS**.

| Workload | Initial → mean live formations¹ | Mean tick | P95 tick | Worst observed tick | Ticks over 16.67 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Turkey–Iraq, lighter deployment | 240 → 300 | 12.62 ms | 26.73 ms | 243.40 ms | 11.6% |
| Turkey–Iraq, dense deployment | 1,000 → 1,230 | 28.68 ms | 53.26 ms | 232.51 ms | 95.4% |
| Russia–China | 2,400 → 2,992 | 97.62 ms | 177.36 ms | 379.44 ms | 100.0% |
| Germany/France/Italy/Poland FFA | 1,600 → 1,936 | 61.25 ms | 88.73 ms | 518.64 ms | 100.0% |

¹ Mean live formations from the first repetition; deterministic counts matched the other repetitions. Initial formations contain 1,000 game personnel each, with additional recruitment reserves.

Run means were 12.71/12.77/12.37 ms for the lighter case, 28.09/28.20/29.76 ms for dense regional, 95.85/99.37/97.65 ms for Russia–China, and 61.29/60.14/62.33 ms for FFA. Thus the conclusion does not depend on a single slow repetition. Worst observations are individual samples and remain sensitive to scheduling and JIT/GC effects.

The lighter case fits the budget on 88.4% of measured ticks, but its 243 ms worst tick still warrants investigation. Larger cases are persistently CPU-limited at this requested tick rate on this host.

## Memory and startup context

| Workload | Largest sampled process RSS across three runs | ArrayBuffers at end of first run | Sparse influence storage, first run |
| --- | ---: | ---: | ---: |
| Turkey–Iraq, lighter deployment | 633.9 MiB | 359.4 MiB | 0.9 MiB |
| Turkey–Iraq, dense deployment | 762.6 MiB | 359.4 MiB | 0.9 MiB |
| Russia–China | 1002.9 MiB | 363.5 MiB | 5.0 MiB |
| Germany/France/Italy/Poland FFA | 848.3 MiB | 360.3 MiB | 1.9 MiB |

RSS is sampled every 60 ticks and at boundaries; these are **sampled maxima, not true process peaks**. ArrayBuffers and influence storage are components of process memory and must not be added to RSS. These Node processes have no browser, GPU or rendering mirror; the numbers cannot establish a Chrome crash limit or total browser memory.

The first run's core-construction durations were 193 ms (light), 197 ms (regional), 307 ms (large), and 223 ms (FFA). Binary decoding took roughly 513–653 ms in those runs. These are Node stages on the legacy fixture, not the complete browser worker INIT→READY path: they exclude browser module startup, state capture/serialization and control-delta tracker initialization. They neither explain nor rule out the browser's repeated five-second world-map initialization timeout.

The near-constant 359–363 MiB ArrayBuffer allocation across army sizes is a reason to investigate true regional grid allocation and duplicate state lifetimes. The current Eurasia mask preserves global grid dimensions; no smaller-grid memory saving was measured here.

## Current CPU hotspots

A separate Russia–China diagnostic used the same 300-tick warm-up, followed by **300 measured ticks**. Its unprofiled control averaged 98.83 ms (P95 175.70 ms), consistent with the longer baseline. V8 CPU sampling then collected 27,174 samples over 30.40 seconds in a fresh process.

Self CPU grouped by source module:

| Module | Sampled self CPU |
| --- | ---: |
| `army-navigation.js` | 26.75% |
| `ground-unit.js` | 20.83% |
| `territory-ledger.js` | 8.20% |
| `simulation-tick.js` | 7.62% |
| `ai-runtime.js` | 7.57% |
| `tactical-grid.js` | 6.33% |

The leading individual functions were `updateFormation` (20.78% self, 46.44% inclusive), navigation `direction` (12.51% self), and navigation `beginTick` (7.55% self). Hot source-line samples include route-field cache eviction near `army-navigation.js:366–367`. This makes route-field reuse, cache maintenance and repeated per-formation navigation concrete profiling targets; a line sample alone does not establish an optimization's benefit.

The separate detailed-timer pass recorded averages of 59.00 ms in the formation loop, including 23.46 ms combat/movement and 9.61 ms enemy scanning. Enemy candidate visits averaged 43,366 per tick. Operational task-force updates averaged 20.01 ms, while legacy planning averaged 1.51 ms. This current large-war sample should guide follow-up work instead of assuming the older regional enemy-scan ranking still applies unchanged.

Detailed categories overlap and instrumentation adds overhead; do not sum them or directly substitute their totals for the unprofiled baseline. Inclusive CPU percentages also overlap. Sampled GC was about 2.07%; it was not the largest steady CPU category in this run.

## Periodic stalls

The detailed pass attributes major stalls to frontline work and operational AI:

- Tick 311: 569 ms instrumented total, including **441 ms frontline dispatch**.
- Tick 465: 332 ms instrumented total, including **242 ms frontline dispatch**.
- Ticks 541–542: operational task-force updates consumed about **163–182 ms** each.

The frontline spikes match the field-refresh schedule (150 ticks gated by the seven-phase wheel). The lighter and FFA timing-only runs also have slow ticks at 311/465/619/773; this is a useful correlation, not a direct phase attribution for those separately measured runs. The large-war detailed pass verifies the frontline attribution for its own ticks 311 and 465.

## Snapshot transport costs

A separate Node worker probe exercised the actual production snapshot/delta format and mirror application for 150 snapshots, one per two logical ticks. It does not render, sleep to a display clock, or send data over a network.

| Per-snapshot operation | Mean | P95 |
| --- | ---: | ---: |
| Pack snapshot | 18.02 ms | 24.27 ms |
| `postMessage` call | 2.53 ms | 3.24 ms |
| Delivery including scheduling/structured clone | 12.32 ms | 19.40 ms |
| Apply to mirror | 9.69 ms | 13.78 ms |

The measured numeric payload averaged **897,048 bytes (0.856 MiB)** and reached 1,029,240 bytes (0.982 MiB). This excludes some structured-cloned object data and is not a WebSocket bandwidth measurement. Delivery includes posting/cloning work, so the rows must not all be added as independent costs. The final mirror tick and formation count matched the worker (tick 600, 3,000 formations).

Snapshot work is substantial even before network transport. A server-side simulation prototype needs a deliberately measured remote presentation protocol, rather than copying the existing worker messages unchanged.

## Recommended next work

1. **Diagnose the reproduced world-map worker startup failure** from the browser report: instrument capture, transfer, module startup, core construction, tracker creation and READY delivery. Avoid treating a larger timeout as proof of a fix.
2. **Reduce steady simulation work using the current profile:** investigate navigation field-cache reuse/eviction, per-formation movement and operational task-force scheduling. Preserve gameplay behavior with the existing movement/AI regressions and repeat matching workloads.
3. **Bound frontline rebuild and operational AI spikes.** The phase measurements provide specific events to reproduce, separately from average tick throughput.
4. **Measure snapshot size, packing/application, aggregate browser/worker memory and rendering on real devices.** Consider true regional grid origins/extents only with loader/export/pathfinding coverage; masking alone does not shrink allocations.
5. Keep backend persistence and PostgreSQL in the [backlog](BACKLOG.md). Persistence supports saves and profiles; server simulation could offload clients, but neither automatically makes this CPU-bound core meet its tick budget. Decide on that prototype after the above measurements and product requirements for shared/persistent games.

No engine optimization, backend or database was implemented during this baseline.

## Commands and local evidence

The profiler regression passed before timing: `node scripts/cli-profiler-smoke.mjs`. Existing fixture/default behavior was preserved; no new profiler API was added.

```sh
node scripts/profile-performance.mjs --case all --grid-res 0.1 \
  --warmup 300 --ticks 600 --repeat 3 --no-cpu --no-transport \
  --output performance-results/0.28.6-cpu-baseline

node scripts/profile-performance.mjs --case regional --grid-res 0.1 \
  --units-per-side 120 --warmup 300 --ticks 600 --repeat 3 \
  --no-cpu --no-transport --output performance-results/0.28.6-cpu-light

node scripts/profile-performance.mjs --case large --grid-res 0.1 \
  --warmup 300 --ticks 300 --repeat 1 --phases \
  --output performance-results/0.28.6-cpu-diagnostics
```

Each ignored output directory contains `report.json` and `report.txt`; the diagnostic directory also contains `large.cpuprofile`. `0.28.6-cpu-baseline/source.json` records the source fingerprint and start/end host load. The JSON records per-tick samples, workload/map/config hashes, memory samples, individual run means and diagnostic phases. Preserve these artifacts for a later matching-host/workload comparison; this document is the repository summary.
