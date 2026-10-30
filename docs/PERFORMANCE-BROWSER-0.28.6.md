# Browser observations: Docker 0.28.6

Measured on 2026-10-28 against `https://modern-wars.bald1nh0.net/` after deploying image `moder-wars:0.28.6-playtest` (`sha256:87872b082f648801289516d9cae9168a5932f88d718cc2c575343a35047e6368`). This is an exploratory baseline, not a before/after comparison or a real-device benchmark.

## Method and limitations

- Headless Chrome 155 on Linux, device-pixel ratio 1. The renderer identifies itself as ANGLE/Vulkan **SwiftShader**, so graphics work runs in software. The measured frame rate is not a prediction for a Mac or Android phone.
- Desktop layout: 1280×720; mobile layout: 390×844. Changing viewport size does not emulate a phone CPU, GPU, memory limit, touch device, or network.
- Both built-in scenario assets were loaded through the actual released interface at the default 0.1° grid / 50m map setting. Both allocate 6,480,000 cells, including the masked Eurasian theater.
- Each layout/scenario had one cold and one warm load. CDP cleared the HTTP cache before the cold load and bypassed service-worker responses for controlled measurements; these do not measure offline service-worker performance. The public origin is reached from its hosting machine, so download times do not represent a player's internet connection.
- The existing browser benchmark uses **Russia versus China**, including when run on the Ukraine/Eurasia map. Each side starts with 120 formations / 120,000 game personnel, speed 1×, political view, 3 seconds of warm-up and 20 seconds of measurement. This is not a reconstruction or measurement of a Ukraine–Russia playthrough.
- A lightweight Worker wrapper records construction, INIT, READY, termination, and message counts without retaining snapshot payloads. The game's existing basic profiler records frame/tick statistics. One additional world-map run used CDP CPU sampling as a separate diagnostic, not an uninstrumented timing repeat.
- Browser runs completed before the separate Node CPU suite began. They used a shared development host; other services were not stopped.

## Scenario loading

| Scenario/layout | Cold load | Warm load | Compiled scenario bytes | Allocated cells |
| --- | ---: | ---: | ---: | ---: |
| Modern World 2026 / desktop | 7.775 s | 5.252 s | 139,239 | 6,480,000 |
| Ukraine 2023 · Eurasia / mobile layout | 2.972 s | 2.777 s | 212,017 | 6,480,000 |

These are the application's scenario-load trace durations, not page navigation or time-to-first-paint. Modern World 2026 downloaded its scenario in 12.7 ms in the cold run, decoded it in 780.8 ms, and spent a further 1.651 s in geography setup. The final `cities-ready → complete` interval was 4.595 s. That last interval includes multiple operations and cannot be attributed to a single renderer or snapshot function without finer tracing. Warm world load was 5.402 s in the separate sampled diagnostic.

Different scenarios and viewport sizes are different workloads. The table does not isolate the performance benefit of the theater mask.

## Simulation ownership and responsiveness

| Observation | Modern 2026 / desktop | Eurasia / mobile layout |
| --- | ---: | ---: |
| Worker INIT → READY | No READY; terminated after 5.064 s | 2.401 s |
| Execution owner during benchmark | Main-thread local fallback | Worker |
| READY / SNAPSHOT messages observed over startup + benchmark | 0 / 0 | 1 / 69 |
| Mean reported simulation tick | 61.35 ms | 22.55 ms |
| P95 reported simulation tick | 67.60 ms | 47.20 ms |
| Largest reported simulation tick | 691.5 ms | 204.3 ms |
| Mean presentation frame interval | 408.0 ms | 320.9 ms |
| P95 presentation frame interval | 888.6 ms | 393.0 ms |
| Main-thread long tasks during measured run | 32 | 62 |
| Largest recorded long task | 1,018 ms | 438 ms |

The world-map diagnostic reproduced the startup failure: no worker messages and termination 4.992 seconds after INIT. Both failures logged `Using local simulation owner: Simulation worker did not initialize`. Eurasia successfully used the worker in its one measured run. This establishes a reproducible world-map startup symptom in this environment, not its root cause or incidence on real devices.

Frame intervals correspond to approximately 2.45 and 3.12 presentation frames/second in this software-rendering environment. Do not quote these as gameplay FPS on a physical phone or Mac. Simulation tick timing and presentation frame rate measure different work. The main-loop `browserWaitMs` also includes time outside that callback; it must not be interpreted as pure idle time or GPU wait.

## Memory and diagnostic profile

End-of-run CDP `Runtime.getHeapUsage` values for the main renderer:

| Sample | Used JS heap | Backing storage |
| --- | ---: | ---: |
| Modern 2026, local fallback | 512.1 MiB | 791.4 MiB |
| Eurasia, worker owner | 304.7 MiB | 276.2 MiB |
| Modern 2026, separate CPU diagnostic | 539.1 MiB | 840.8 MiB |

These are endpoint samples, not peaks or process RSS. In particular, the Eurasia row excludes its separate simulation worker's heap, and GPU memory is not included. Therefore the rows cannot establish a total-memory reduction, a leak, or a browser crash threshold. The built-in periodic memory report had no samples in these runs; no missing measurement was treated as zero.

The diagnostic profile covers war startup, warm-up, and the measured run. About 51.2% of sampled time was attributed to `(program)` and 2.6% to garbage collection. Identified JavaScript samples include political chunk/material resolution, region geometry, war setup, and GPU geometry preparation. The unattributed portion prevents a defensible claim that one named JavaScript function explains the long stalls; a focused browser trace is the next diagnostic step.

Known unrelated console errors included the meta-delivered `frame-ancestors` directive, a missing favicon, and optional `super-secret-settings` audio files returning 404. These were not classified as simulation failures.

## Recommended next investigation

1. Trace world-map worker startup: state capture/transfer, module initialization, core construction, and control-delta tracker initialization. Determine why READY misses the current five-second limit before merely increasing the timeout.
2. Measure aggregate main-thread + worker + graphics memory on a real Mac and Android device. Check duplicate initial state and fallback ownership lifetimes.
3. Attribute the long main-thread intervals to snapshot application, map invalidation/chunk rebuilding, native canvas/WebGL work, or other callbacks using a focused trace.
4. Combine these findings with the [current CPU baseline](PERFORMANCE-0.28.6.md) before implementing any backlog option. Database persistence does not address the observed initialization, rendering, or simulation work.

## Local artifacts and reproduction

Ignored local evidence is stored in `performance-results/release-0.28.6/browser/`:

- `probe.js`: the Playwright CLI function, with a JSON options placeholder.
- `modern-desktop.json`, `ukraine-mobile.json`: complete load, browser, worker, and benchmark reports.
- `modern-diagnostic.json`, `modern-main-thread.cpuprofile`, `modern-main-thread-top.json`: separate sampled diagnostic.
- Matching `.log` files retain the exact expanded CLI code and returned results.

Use an isolated named Playwright CLI session, execute `probe.js` after replacing `__OPTIONS__` with the scenario and viewport configuration, and close that browser before timing the Node suite. The first run installs worker observation; subsequent runs in the same page set `reuseWorkerProbe: true`. `warmOnly: true` preserves the HTTP cache; `profile: true` enables the separate CDP diagnostic. Do not run the CPU suite, a production build, or another browser benchmark concurrently.
