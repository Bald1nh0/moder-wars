# Mac browser versus server simulation

Measured by the player on 2026-10-28 using the feature-flagged device test in
`0.28.7-server.2`. Both supplied reports are valid and pass
`comparableDeviceReports`: build, scenario, settings, viewport, environment and
initial forces match. These are one run per mode, not repeated deterministic runs.

## Inputs and environment

Local artifacts (intentionally not committed):

- `output/playwright/device-feature/modern-wars-browser-performance-1793215069529.json`
  SHA-256: `3d1da6a6abcfde05db4bc8ed8fc3f30220cca4f9666003aad84733c9433f54a2`
- `output/playwright/device-feature/modern-wars-server-performance-1793215112600.json`
  SHA-256: `a97f25139d98c7647369973137e8b18a142b33c11547a95cad55be5cde6d38bd`

Read the `current` object of each download, not an older embedded comparison.

- Client: Chrome 156 on Mac; renderer reports ANGLE Metal, Apple M5 Pro.
  Viewport: 3360x1768 CSS pixels, DPR 2; reported hardware concurrency: 15.
  The Intel/macOS version in the user-agent string is not a reliable hardware/OS inventory.
- Server host currently reports Intel Xeon E5-2690 v2 @ 3.00 GHz with 16 visible
  logical CPUs. Historical host load, CPU frequency and concurrent work were not
  recorded in these reports. Hardware and runtime differ between owners.
- Workload: Modern 2026, Russia/China, 120 formations and 120,000 personnel per
  side initially, grid 0.1, political view, speed 1x, 3-second warm-up and a
  20-second measurement. Both recorded measurement intervals were 20.005 seconds.
- The browser used its worker successfully, with **no main-thread fallback**.
  The server used its server worker and negotiated per-message deflate.

## Comparison

| Metric | Browser worker | Server worker |
| --- | ---: | ---: |
| Owner startup | 0.673 s | 6.514 s |
| Recorded simulation ticks | 1,200 | 559 |
| Approximate observed ticks per wall-clock second | 59.99 | 27.94 |
| Approximate logical pace relative to 60 ticks/s at 1x | 100% | 46.6% |
| Mean tick duration | 4.69 ms | 28.05 ms |
| P95 tick duration | 9.50 ms | 67.90 ms |
| Largest tick | 32.00 ms | 232.27 ms |
| Recorded application render calls | 481 | 343 |
| Application render calls per wall-clock second | 24.04 | 17.15 |
| Mean duration of a rendered frame | 19.23 ms | 17.11 ms |
| Browser animation-loop callbacks per second | 59.80 | 59.90 |
| Main-thread long tasks during measurement | 1 (58 ms) | 0 |

Tick rates use `report.ticks.count` divided by the measurement interval. There is
no history truncation in these short runs (the limit is 4096); remote counter resets
and final snapshot delivery are asynchronous, so this is an approximate observed
rate rather than an exactly synchronized server-clock measurement. The difference
is much larger than a boundary snapshot. Render rates use
`report.frames.renderedFrameRenderMs.count`, not all animation-loop callbacks.
They measure application paint calls, not physical monitor/compositor frames.

The client received 165,029,840 raw protocol bytes and sent 201,750,171 in the
server run. Those counters include initialization and warm-up and precede WebSocket
compression; they do not establish compressed bandwidth, latency or a compression
ratio. Snapshot totals also include warm-up and must not be divided by 20 seconds
as if they were measurement-only counters.

## Why missiles look slower

The clock in `src/simulation-clock.js` targets 60 logical ticks per second at 1x.
`src/simulation-tick.js` advances missile progress by a fixed amount per logical
tick. Impact damage and explosion lifetime also follow simulation ticks.
`src/render-units.js` draws the received coordinates without interpolation.

The server advanced about 46.6% as much simulation time in the measurement window.
The same flight therefore takes approximately 2.15 times as long in real time
at that average pace. The slower progression affects the world, not only missile
decoration. Fewer rendered updates further reduce visual smoothness.

The server's mean tick already exceeds the 16.67 ms budget for 60 ticks/s.
Tick duration is measured inside the simulation owner, separately from transport
encoding; extra snapshot, scheduling and transport work can further reduce
throughput. These reports do not isolate the contribution of hardware, runtime,
other host work, random gameplay or each transport stage.

`report.benchmark.avgFps` and `report.frames.avgFps` currently count animation-loop
callbacks, including callbacks that skip painting. Their approximately 60 values
and the existing FPS verdict do **not** show that either mode paints 60 distinct
game frames or maintains full simulation speed. `ticks.approxFps` is the reciprocal
of mean tick duration, also not observed ticks per wall-clock second.

## Decision and next checks

1. Keep browser simulation as the default for this Mac. The earlier headless
   fallback did not reproduce here; the local worker started in under a second.
   This pair provides no evidence that server simulation is faster on this device.
2. Extend diagnostics with observed TPS, logical pace and actual render-call rate,
   and distinguish them from animation-loop cadence. Record counter boundaries and
   monotonic elapsed time explicitly in future reports.
3. Profile the server tick and snapshot pipeline separately. At the observed cost,
   increasing the speed selector cannot make the server sustain the target rate.
   Prioritize AI, unit updates and periodic frontier work; repeat on the same fixture
   before attributing changes to the backend language.
4. Evaluate interpolation only for smooth presentation, preserving authoritative
   impact/damage timing. It cannot recover missing simulation throughput.
5. Repeat both modes on Mac and Android. This is evidence for this device, workload
   and server run, not a general conclusion about all server simulations.

No gameplay timing or running server configuration was changed by this analysis.
