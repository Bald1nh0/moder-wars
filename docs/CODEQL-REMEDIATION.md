# CodeQL remediation review — 2026-10-29

Local follow-up to draft PR #2, starting at commit
`bfa6dfd2b44cd754ea2b63999d841be09c717038`. The owner authorized committing
and pushing these reviewed changes to the feature branch on 2026-10-29.
Main merges, releases and deployment remain on hold. No GitHub alerts were
manually dismissed by this remediation.

## Results

Full local analysis with CodeQL CLI 2.27.3, JavaScript queries 2.4.8 and the
unchanged `javascript-security-extended` suite completed successfully:

| Rule | Before | After |
| --- | ---: | ---: |
| Remote property injection | 35 | 2 |
| Prototype-polluting assignment | 1 | 0 |
| Insecure randomness | 3 | 3 |
| Missing origin check | 5 | 5 |
| Client-side request forgery | 2 | 2 |
| File access to HTTP | 1 | 1 |
| **Total full-scan findings** | **47** | **13** |

This removes 34 full-scan findings and their stale review entries. Comparing
the same locations with the PR annotations removes 33 of its 40 open alerts;
the expected remaining open count is **7**, pending a future hosted scan:

- `src/ground-unit.js:474`, `:481`, `:504`: game randomness (three).
- `src/simulation-protocol.js:107`: filtered custom-field cloning (one).
- `workers/geo-raster-worker.js:4`, `workers/scenario-worker.js:78`,
  `workers/war-simulation-worker.js:98`: dedicated worker channels (three).

The other six local findings are two worker findings absent from the PR
annotations and four findings already dismissed by the owner. No new findings
were introduced. Counts measure scanner results, not the number of demonstrated
exploitable vulnerabilities.

Analysis input SHA-256:
`ddfaa5ea7816bd5d6506327d172db0e248dde54e5c2da6b47d62c8d158d6dc0e`.
Local SARIF and execution logs are in
`/tmp/mw-codeql-remediation-10533lmq/`. The analyzed snapshot was compared with
all current analysis inputs before updating the 13 individually reviewed entries;
their source-file hashes and finding locations remain unchanged.

## What changed

- **Influence storage:** dense writes now require an actual `Float32Array`.
  Previously, calling `writeInfluence` with `Object.prototype` and a numeric
  index could add a property to that prototype. An isolated reproduction
  confirmed this API-level gap; it is not proof of a complete remote exploit.
  The old exception discussed only the index, but the query tracks the target
  object too. That explanation was incomplete. Regression coverage now rejects
  prototype objects, ordinary arrays, array-like records and wrong typed arrays.
- **Route/frontline buffers:** validate grid dimensions, route endpoints and
  signed cell-index limits. Reuse scratch storage only when all required typed
  arrays have the correct types and lengths. Rebuild malformed buffers rather
  than trusting an arbitrary object with a matching `length`.
- **Side and country indexing:** reject invalid IDs before capturing numeric
  indexes. Prevent clearing a second plan slot through a nonexistent side ID.
  Store neighboring-country counts in a `Map`; preserve the prior tie behavior
  and majority threshold. Use bounded array operations for inactive plan tails.
- **Influence queues:** require real queue arrays and typed flags, then reject
  invalid cell indexes before reading/writing queue state.

Some existing guards already rejected dangerous property names. Capturing their
validated numeric value makes that boundary explicit to both the implementation
and CodeQL. `Number(...)` is not used as a substitute for validation: strings,
objects and symbols at these external index boundaries remain rejected.

## Findings that still require documented review

Do not replace these operations merely to make a scanner count reach zero:

- Game randomness chooses existing allied-country beneficiaries; it does not
  generate secrets, authorization identifiers or cryptographic nonces.
- Dedicated Web Worker message channels are not Window message listeners.
  A Window-style `event.origin` check is not authentication for these channels.
  Message/asset validation remains separate and necessary.
- Generic state cloning and wire decoding preserve custom game fields in fresh
  records. Their reserved-key, inherited-method and descriptor checks remain
  covered by malicious-input tests.
- Worker fetches are restricted to permitted same-origin packaged assets/local
  scenario blobs, omit credentials and reject redirects. The release CLI's
  selected-file upload is an intentional trusted publication operation.

Exact remaining findings stay visible in SARIF and are individually bound to
source hashes and the complete analysis-input digest in
`.github/codeql-reviewed.json`. No query exclusions or blanket suppressions are
introduced.

## Validation scope

The regression suite covers malformed inputs, valid routes, side-slot isolation,
country-majority behavior, dense/sparse influence parity, deterministic simulation,
worker snapshots and ownership handoffs. TypeScript, Biome and an isolated Vite
build are checked separately. Node simulation checks do not establish browser
FPS or real-device rendering behavior.

Passed checks:

- Version synchronization, `npm run typecheck`, `npm run lint` and the complete
  curated `npm run smoke` suite, including both new index-boundary tests.
- Additional AI performance/operation/retreat/budget regressions and dense/sparse
  influence checks (40,000 numeric operations and 120 matching simulation ticks).
- Isolated production build under `/tmp/moder-wars-codeql-validation` and its
  build-output check, including actual worker startup, snapshots, speed changes
  and state handoff. The existing large-bundle size warning remains.
- Full CodeQL scan, exact 13-entry review gate and all 21 gate regression cases.

The running test server and production Docker image were not replaced. Browser
rendering was not retested because these changes affect simulation data handling,
not presentation code. No version bump or protocol change is required for this
unreleased, local review; valid state formats remain compatible.

GitHub's existing count remains unchanged until an authorized push and new scan.
Local full-scan results and PR-visible open alerts are different counts: the
previous full report contained 47 findings, the PR check had 44 annotations,
and four PR alerts had already been dismissed by the owner, leaving 40 open.
