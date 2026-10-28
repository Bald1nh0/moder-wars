# Android browser versus server simulation

Player-supplied device-test reports from 2026-10-28, build `0.28.7-server.2`.
Both `current` reports are valid and pass `comparableDeviceReports`: build,
scenario, settings, viewport, environment and initial forces match. One run per
mode was supplied; this is not a deterministic replay or a repeated benchmark.

## Inputs and environment

Local artifacts (intentionally not committed):

- `output/playwright/device-feature/modern-wars-browser-performance-1793215757340.json`
  SHA-256: `480ce4687f4575d765657f1be2a07af8327706e21692aeabce9d353d33a77046`
- `output/playwright/device-feature/modern-wars-server-performance-1793215817898.json`
  SHA-256: `d69ad04e0695cfbfadd9443644d7799ba8944e8f76df1b7d4ef396e61daa6bde`

Chrome 156 Mobile, reported renderer ARM Mali-G78, 8 logical processors, viewport
411x784 CSS pixels and DPR 2.625. The precise phone model and OS version were not
provided; the reduced `Android 10; K` user-agent string does not establish them.
Device temperature, battery mode, other open games and historical server load were
not recorded. The browser used its worker without fallback; the server run used
its server worker with negotiated per-message deflate.

The workload was Modern 2026, Russia/China, initially 120 formations and 120,000
personnel per side, grid 0.1, political view, speed 1x, 3-second warm-up and a
nominal 20-second measurement. AI outcomes differ: average task-force counts were
2 locally and 3 remotely, so matching initial conditions do not mean identical
work per tick.

## Comparison

| Metric | Browser worker | Server worker |
| --- | ---: | ---: |
| Recorded measurement interval | 20.037 s | 20.083 s |
| Owner startup | 3.130 s | 7.963 s |
| Recorded simulation ticks | 653 | 673 |
| Approximate observed ticks per wall-clock second | 32.59 | 33.51 |
| Approximate logical pace relative to 60 ticks/s at 1x | 54.3% | 55.9% |
| Mean / P95 tick duration | 26.01 / 52.30 ms | 25.25 / 53.66 ms |
| Recorded application render calls | 291 | 207 |
| Application render calls per wall-clock second | 14.52 | 10.31 |
| Mean duration of a rendered frame | 45.55 ms | 56.84 ms |
| Browser animation-loop callbacks per second | 19.20 | 33.05 |
| Largest animation-loop interval | 209.1 ms | 366.0 ms |
| Main-thread long tasks during measurement | 136 | 154 |

Rates use tick or render sample counts divided by the report's recorded
`benchmark.startedAt`/`endedAt` interval. The 4096-entry tick history is not
truncated. Counter resets and remote delivery are asynchronous, so observed TPS
is approximate. Render sample counts can differ from scheduler counters by one
at the report boundary. These are application paint calls, not physical display
frames. Animation-loop callbacks include skipped paints; their higher rate in
server mode does not establish smoother game animation.

The largest server-mode interval includes 311.1 ms classified as `browserWaitMs`.
That is a timing residual, not measured network latency; this report cannot
attribute that single delay to Wi-Fi, CPU scheduling or another browser activity.

The server transport recorded 201,730,025 raw sent bytes and 99,113,113 raw received
bytes, with 1,802.4 ms cumulative application decoding time. These counters include
initialization and warm-up and precede WebSocket compression; they do not measure
compressed bandwidth. Browser heap samples were flat at 553 MB locally and
1,070 MB remotely. Their precision and scope are limited; they do not establish
total device RAM, a leak, or memory savings from either owner mode.

## Interpretation and next steps

- The approximately 2.8% higher observed server TPS is too small to establish a
  repeatable speed advantage from this pair. Both modes sustain only about 55%
  of the target logical pace; missile flight and world progression follow ticks.
- Actual application paint calls were approximately 29% less frequent remotely.
  Painting remains on the phone and cost tens of milliseconds in both modes.
  Neither lower client CPU use nor better overall responsiveness is established
  just by seeing more animation-loop callbacks.
- Keep browser simulation as the practical default on this tested phone for now:
  similar logical pace, more frequent paints and shorter startup. Keep the server
  option experimental; this is not a conclusion about every Android device.
- Profile rendering layers, labels and effects on the phone, alongside AI and
  periodic simulation work. Improve diagnostic labels to separate TPS, logical
  pace and actual paint rate. Test presentation changes with owner mode held fixed.
- Repeat each mode under similar device temperature and background load before
  claiming a small gain. Server startup-by-ID remains a startup experiment; it
  does not solve the measured ongoing simulation or phone rendering costs.

## Together with the Mac result

| Device | Browser observed TPS / paint calls per second | Server observed TPS / paint calls per second |
| --- | ---: | ---: |
| Mac (renderer reports Apple M5 Pro) | 59.99 / 24.04 | 27.94 / 17.15 |
| Android (renderer reports Mali-G78) | 32.59 / 14.52 | 33.51 / 10.31 |

Rows describe separate device-specific pairs, not a controlled hardware benchmark.
See the [Mac analysis](PERFORMANCE-MAC-0.28.7-server.2.md) for its limitations.
Neither pair demonstrates a clear overall gameplay benefit from this server
prototype. No application code or running deployment changed during this analysis.
