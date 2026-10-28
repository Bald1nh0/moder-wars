# Performance decisions after the server prototype

Research date: 2026-10-28. These are proposed experiments, not measured gains or an
approved rewrite. Device testing is implemented separately behind a feature flag.

## What the evidence supports

- The [player's Android comparison](PERFORMANCE-ANDROID-0.28.7-server.2.md) found
  approximately 32.6 local versus 33.5 server ticks/s, with fewer actual paints
  remotely (10.3/s versus 14.5/s). This pair does not establish a server benefit;
  mobile rendering and simulation both require optimization. Worker startup
  succeeded locally, so the earlier headless fallback is not universal.
- The [player's Mac comparison](PERFORMANCE-MAC-0.28.7-server.2.md) changes the
  device-specific conclusion: its local worker starts successfully and sustains
  approximately 60 ticks/s, while this server sustains approximately 28 ticks/s.
  Keep browser mode as the default on this Mac. About 60 animation-loop callbacks/s
  in both reports must not be interpreted as equal simulation speed or paint rate.
- The [CPU baseline](PERFORMANCE-0.28.6.md) identifies navigation (26.75% sampled
  self CPU), formation updates (20.83%), and periodic frontline/AI stalls.
- That baseline's isolated transport probe measured approximately 18.02 ms to
  pack and 9.69 ms to apply a snapshot, with 0.856 MiB of numeric payload on average.
  Those values describe its large-war fixture, not every current browser frame.
- The [server prototype](SERVER-SIMULATION-PROTOTYPE.md) sends roughly 202 MB of
  uncompressed initial application state. Its real browser startup took 9–15 s
  in single runs. The transmitted compressed size and the complete startup phase
  breakdown have not been measured, so this delay cannot all be assigned to the network.
- Modern World and Eurasia both retain a 3600×1800 simulation grid. Hiding excluded
  land does not shrink the underlying allocation.
- Rendering still happens on the client. Software-rendered browser results are
  not a substitute for Mac/Android measurements; moving simulation does not remove
  Canvas/WebGL or presentation-update costs.
- Both the released-build browser check and the new device-test UI reproduced a
  local worker startup timeout followed by main-thread fallback. The local READY
  deadline is 5 seconds. This is a separate responsiveness problem: comparing that
  fallback with the server does not establish a server advantage over a healthy
  browser worker. Profile worker loading, state cloning and initialization before
  changing the deadline or choosing an architecture.

## Prioritized experiments

| Priority | Experiment | What it targets | Verification and trade-offs |
| --- | --- | --- | --- |
| 0 | Diagnose and fix browser worker startup fallback | Simulation work unexpectedly returning to the UI thread | Instrument INIT/READY phases on a real device; retain bounded failure handling. Compare actual worker and server owners after the fix. Increasing a timeout alone does not reduce initialization cost. |
| 1 | Start built-in scenarios from an ID and immutable revision on the server | Browser capture/copy/encoding and the full-state initial upload | Send selected countries and rules; construct the same state on the server. Check initialization equivalence, source/engine versions and session isolation. Keep full-state transfer for custom/imported scenarios and editing. A shared seed requires an explicit RNG contract; it does not exist today. |
| 2 | Reduce remote presentation traffic and work | Snapshot packing, decoding, mirror application and rendering frequency | Test a lower position publication rate (e.g. 10 Hz) independently of simulation ticks, less frequent territory updates, and interpolation. Dirty tiles already exist. Check visible movement, occupation accuracy, pause and command latency; interpolation must never advance authoritative state. |
| 3 | Reuse navigation fields and bound periodic work | Steady CPU cost and long ticks | Profile cache eviction/rebuilds in `army-navigation.js`, formation queries and frontline passes. Repeat the same seeded Node fixture, including correctness checks and P95/P99, before claiming a gain. |
| 4 | Allocate genuinely regional grids | RAM, full-grid scans, initial state and handoff size | Add explicit origins/extents and cover geographic indexing, camera, naval movement, scenario import/export and restart. This is a broader engine change than masking countries. |
| 5 | Port a measured numeric kernel to Wasm/native code | A remaining CPU bottleneck after algorithm improvements | Compare a batched typed-array API against JS, including copies and call overhead. Preserve behavior in both browser and Node. Avoid rewriting UI, networking and unrelated systems to optimize one loop. |

The local startup issue remains relevant to affected devices; it did not occur in
the player's Mac run. Server tick throughput is the immediate bottleneck for that
comparison. Priority 1 targets startup cost, not its slow ongoing logical pace.

The smallest useful startup architecture experiment is priority 1 behind a separate
flag, using one pinned built-in scenario. Keep the current full-state path as the
comparison. Measure capture/encode, network bytes, server decode/core/tracker,
READY delivery, peak memory and command latency. Loading geography on the server
does not by itself eliminate the client's rendering buffers or per-session mutable
server grids. Share only data proven immutable.

## Compression: already offered, still worth measuring

### Static downloads

Compiled scenarios already use application-decoded `.mwsc.gz` files. The Docker
origin configuration currently sets `gzip off`; the experimental Node static server
also sends JS/CSS without content encoding. Compression at any external reverse
proxy must be checked separately. Selective HTTP gzip (or prebuilt Brotli where
supported by the serving stack) is a cold-load experiment for text assets, not a
simulation CPU optimization. Measure transferred bytes and cold-load timing.
Keep application-decoded binary gzip assets separate: do not attach a misleading
`Content-Encoding` header or recompress them indiscriminately. Nginx supports
selection by [MIME type](https://nginx.org/en/docs/http/ngx_http_gzip_module.html#gzip_types)
and logging the compression ratio. No production serving configuration was changed.

### Live simulation transport

The prototype configures `ws` per-message deflate, server level 1, no context
takeover, a 1024-byte threshold and concurrency limit 2. The browser performs the
negotiated compression transparently. Reports now include `WebSocket.extensions`
to distinguish a server offer from actual negotiation; the property is defined by
the [WebSockets Standard](https://websockets.spec.whatwg.org/#dom-websocket-extensions).
The device-test browser validation negotiated
`permessage-deflate; server_no_context_takeover; client_no_context_takeover`.

`bytesSent` and `bytesReceived` are application packet sizes, not compressed TCP
traffic. Do not compute a network compression ratio from them. A future controlled
compression experiment needs attributed connection byte counts and separate CPU,
memory, latency and encode/decode measurements.

Adding application-level gzip with `CompressionStream` on top of negotiated
WebSocket compression introduces another compression pass and does not remove
raw-grid allocation. Use it only if a measured alternative transport or file/export
format needs it. The [Compression Streams specification](https://compression.spec.whatwg.org/)
describes the streaming API; [ws documentation](https://github.com/websockets/ws#websocket-compression)
explicitly discusses CPU/memory overhead, and [Node zlib documentation](https://nodejs.org/api/zlib.html#threadpool-usage-and-performance-considerations)
discusses concurrency and memory considerations.

## Another backend language

The server already uses [Node worker threads](https://nodejs.org/api/worker_threads.html)
to keep CPU simulation out of the HTTP loop and isolate sessions. Changing only
the HTTP/WebSocket layer to Go or Rust would leave the current JavaScript simulation
cost intact. Rewriting the whole engine creates a second implementation to verify
and maintain before any speedup is established.

A targeted Rust/C++ numerical kernel compiled to [WebAssembly](https://webassembly.org/docs/high-level-goals/)
could be reused by browser and server. Its benefit remains a hypothesis until the
same workload, allocation/copy costs and correctness are compared. Start with an
algorithmic improvement and a profile, not a language benchmark unrelated to this game.

## Redis and databases

Active grids and formations already live in their owner's memory. Putting these
rapidly changing values in Redis would add serialization and interprocess/network
access to their current local access path. The [Redis client-side caching guide](https://redis.io/docs/latest/develop/reference/client-side-caching/)
describes why local memory avoids network round trips and why frequently updated
data is a poor caching candidate.

Redis may later serve presence, room metadata or coordination between multiple
servers. A durable database/checkpoint store may support accounts and saved games.
Neither is a demonstrated fix for navigation, frontline computation or client
rendering, and neither is added by this iteration.
