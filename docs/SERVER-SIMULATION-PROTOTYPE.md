# Server simulation prototype

Branch: `experiment/server-simulation`. Development version: `0.28.7-server.3`.
The frozen Docker playtest remains on `0.28.6`.

This experiment moves the existing simulation owner to Node.js. The browser still
loads the map, prepares initial state, renders it, and applies presentation updates.
It does not add a database or change simulation rules. The purpose is to test
whether removing ongoing simulation CPU work helps actual Mac and Android clients.

## Run separately from the released game

Requirements: Node.js 24+, npm, and a free port. Run from the repository root:

```sh
npm ci --ignore-scripts
npm run build -- --outDir /tmp/moder-wars-server-prototype/dist
MW_STATIC_DIR=/tmp/moder-wars-server-prototype/dist \
  MW_HOST=127.0.0.1 MW_PORT=4180 npm run prototype:server
```

Open `http://127.0.0.1:4180/?simulation=server` for server simulation, or
`http://127.0.0.1:4180/?simulation=browser` to explicitly select browser simulation.
For a trusted LAN playtest, set `MW_HOST` to the machine's LAN address and use that
address in both URLs. This prototype has no user authentication; keep it off the
public production proxy. Stop the prototype process to roll back; the stable
container and its files are independent.

## Simulation owner preference (separate feature flag)

**Settings → Advanced → Server simulation (experimental)** is off by default.
The setting persists in this origin's localStorage under
`mw.feature.serverSimulation`; missing or unavailable storage defaults to browser
simulation. Explicit `?simulation=browser` / `?simulation=server` links override
the preference for that page without saving a different preference.

The current tab retains the owner selected when it loaded. Changing the setting
saves the choice and updates the reload URL, but never migrates or restarts the
current game. The adjacent **Open a new game** link starts a fresh tab in the chosen
mode. Its label and the current-tab status make the two modes explicit. No game
state transfers to the new tab. Server mode needs this compatible server at the
same origin and an ongoing connection; a static-only host does not provide it.

The performance-test feature remains independent. Each test URL explicitly selects
its requested mode, including browser tests when the saved play preference is server.

Validation for `0.28.7-server.3` covered browser default, saved opt-in on ordinary
page loads, explicit browser test override, switching off a server URL, preserved
current-tab mode, fresh-tab navigation and Ukrainian mobile settings. The full
smoke suite, typecheck, lint and isolated build checks passed. Existing simulation
and transport rules were not changed by this preference feature.

## Device performance test (feature flag)

The diagnostic UI is disabled by default. Enable **Settings → Advanced →
Performance testing**, or open the prototype with `?performanceTest=1`. The switch
persists in this browser and can disable a URL override. `?performanceTest=0`
explicitly hides the feature for that page. This is UI gating, not authorization.

The Performance test entry opens a test panel. Browser/server choices open a
separate fresh tab, preserving the current game. Start each test manually; run
one at a time, keep the test tab active, keep its window size unchanged, and pause
or close other games. The workload uses Modern 2026, Russia versus China,
120 formations per side, 1x speed, 3 seconds of warm-up and 20 seconds of measurement.
Startup/loading takes additional time. This is a synthetic performance workload,
not a historical scenario or a deterministic replay.

Download the JSON reports and compare runs from the same device, browser, viewport,
settings and build. Reports identify the requested mode and actual simulation owner,
including browser main-thread fallback. Backgrounded, resized, failed or empty runs
must not be used as successful performance samples. Switching the feature off hides
its controls; it does not switch an ongoing game's simulation transport.

Reports are downloaded by the player and stored locally for comparison. There is
no automatic report upload or account synchronization. Browser-provided memory
figures, when available, do not cover all graphics/native/server memory. Raw packet
counts are not compressed network byte counts; `extensions` records negotiated
WebSocket extensions for the server connection.

See [optimization research and proposed experiments](PERFORMANCE-NEXT-STEPS.md)
for next steps beyond this diagnostic feature.

The `0.28.7-server.2` UI was exercised in real headless Chrome: toggling and
persisting the flag, opening separate test tabs, completing both modes, downloading
JSON and displaying the comparison. Cancellation and viewport changes produced
invalid reports; returning to the menu and disabling a URL-enabled flag survived
reload. Ukrainian controls were visually checked at 390x844. The server run used the server worker and
negotiated per-message deflate. The browser run accurately reported main-thread
fallback after the existing local worker initialization timeout. These are
functional checks on the shared development host, not a Mac/Android speedup claim.

## Session behavior

- Each connected browser owns a separate Node worker and game. Two browsers do
  not share armies, commands, or settings. The default limit is two sessions.
- A binary graph codec preserves typed grids, shared references, dates, maps,
  and sets. WebSocket compression reduces repetitive numeric payloads; raw packet
  counters must not be mistaken for compressed network bandwidth.
- The Node scheduler yields between backlogged turns so network acknowledgements
  and controls are serviced even when ticks exceed their real-time budget.
- The existing snapshot acknowledgement limits presentation updates to one
  outstanding snapshot. Simulation can continue while a tab is backgrounded.
- Pause and speed commands control the server simulation. Full-state handoff
  remains necessary for editing, which can transfer large arrays again. The client
  waits for the old socket to close before opening its replacement.
- Connection loss ends the server session and visibly stops the client. There
  is no automatic local fallback, reconnect recovery, or durable save in remote
  mode. Reloading starts a new game. Browser preferences remain local.
- Startup may take longer because initial game state must cross the connection.
  The prototype uses a separate bounded remote startup deadline; this does not
  resolve the existing local worker startup issue.

## Validation and observation

The [player's real Android comparison](PERFORMANCE-ANDROID-0.28.7-server.2.md)
found about 33 ticks/s in both modes, with application paints less frequent in
server mode (10.3/s versus 14.5/s). The higher animation-loop callback rate remotely
does not establish smoother animation or faster simulation. Both modes remain
below the 60-tick/s target; the single pair does not demonstrate an overall server
advantage on this phone.

The [player's real Mac comparison](PERFORMANCE-MAC-0.28.7-server.2.md) found
successful local worker startup and approximately 60 local versus 28 server ticks/s.
This server run slowed logical game time and missile flight despite approximately
60 animation-loop callbacks/s in both modes. Keep the browser default for that Mac;
the prototype has not demonstrated a speed advantage there.

```sh
node scripts/simulation-wire-smoke.mjs
node scripts/remote-simulation-smoke.mjs
node scripts/server-simulation-smoke.mjs
npm run typecheck
npm run lint
npm run smoke
```

Use `/health` for aggregate server session and traffic counters. In browser
DevTools, `window.serverSimulationStatus` reports the selected remote transport,
readiness, and message counters. Keep the server connection indicator visible
when comparing results; a local fallback is not a server performance result.

For a useful comparison, use the same scenario, countries, army counts, camera,
speed, viewport, and device in both URLs. Record startup time, frame stalls,
server tick time, client memory, network traffic, and disconnect behavior.
Headless Chromium with SwiftShader can verify correctness and transport, but its
FPS is not representative of a physical phone or Mac GPU.

### Verification on 2026-10-28

Both built-in maps completed a real browser run with the server owner and no local
fallback. Each run used the existing Russia/China benchmark (120 formations per
side, 1x speed, 3-second warm-up and 20-second measurement). Loading the Ukraine
theater does not make this benchmark a Ukraine/Russia battle.

| Observation | Modern 2026, 1280x720 | Eurasia, 390x844 |
| --- | ---: | ---: |
| Remote owner construction to READY | 14.67 s | 9.09 s |
| Snapshots received through report capture | 31 | 63 |
| Measured simulation ticks | 591 | 581 |
| Mean / P95 server tick | 29.75 / 71.89 ms | 30.61 / 69.67 ms |
| Mean presentation frame interval | 282.42 ms | 164.29 ms |
| Sent raw protocol bytes through report capture | 201,725,509 | 201,477,946 |
| Received raw protocol bytes through report capture | 20,361,951 | 33,124,196 |

These are single runs on the shared Xeon development host using headless Chrome
155 and SwiftShader, not a controlled before/after comparison. Desktop/mobile
layouts are different rendering workloads on the same computer. Counters include
startup and warm-up; WebSocket compression means they are **not network-byte
measurements**. The roughly 202 MB raw initial state remains a startup and memory
cost. Rendering and snapshot application still consume client resources.

Browser verification also confirmed that stopping the prototype server changes
the indicator to an explicit failure requiring reload. Real-worker integration
tests cover two isolated sessions, ACK backpressure, pause/speed, full-state
handoff, and session cleanup. A regression covers Node MessageChannel starvation
under sustained backlog; the first experimental run without the scheduler adapter
had frozen presentation and is not a valid performance result.

Local browser reports and screenshots are under
`output/playwright/server-prototype/` (untracked artifacts). Repeat on a physical
Mac and Android phone before deciding whether the extra server and network cost
is worthwhile.

## Limits before production

This is an isolated-session LAN prototype, not a multiplayer service. Persistence,
accounts, reconnect snapshots, command authorization, smaller regional grids,
capacity planning, and production monitoring remain separate backlog work.
Worker heap limits do not include every native buffer allocation. Session and
packet limits bound this experiment but are not a complete hostile-client sandbox.

Implementation references: [Node worker threads](https://nodejs.org/api/worker_threads.html)
and [ws](https://github.com/websockets/ws).
