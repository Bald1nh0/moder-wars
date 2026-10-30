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

## 2026-10-30 — Numeric version metadata review

The `0.30.0` promotion changes only five version-string occurrences across
`package.json`, `package-lock.json`, `index.html` and
`workers/service-worker.js` among analysis inputs. Verified each entire file
against HEAD with only `0.30.0-experimental.1` replaced by `0.30.0`; dependency
versions, scripts, CSP and worker logic are unchanged. All 13 reviewed finding
source hashes remain identical, so their existing rationales and exact locations
remain applicable. No exceptions were added or broadened.

The review input digest is
`b9fc695e80ca5e7415d5b0c588b0f573319ad2bf9153e40d9c8015679cbfa45c`.
Version/release regressions, lint and all 21 CodeQL gate tests passed. This was a
focused metadata review, not a new full local CodeQL scan; CI still requires the
full scan and rejects any new or changed findings before publishing.

## 2026-10-30 — Single-source version and browser branding review

Repeated the full security-extended analysis with CodeQL CLI 2.27.3 and
JavaScript queries 2.4.8 after deriving UI/report versions and offline-cache
identifiers from package metadata. The scan still contains exactly the same
13 reviewed findings, including identical rule IDs, source ranges, counts and
source-file hashes. No exceptions were added or broadened. The version helper
still validates package metadata; its narrower write scope removes HTML/worker
edits. The browser reads a numeric version from build-generated metadata, and
the cache fingerprint hashes local build assets. These changes introduce no
new untrusted input to the previously reviewed sinks.

Verified all 293 current analysis-input files against the isolated scan source
snapshot before rebinding the existing reviews to digest
`4b4e0163ef918bd610d8b3431276b980179701ae238c20e3960924bfe4d47bda`.
The exact review gate and all 21 gate regression tests passed. Local SARIF and
logs are retained in `output/playwright/version-branding/codeql/` (locally
ignored by Git). This full scan supersedes the focused numeric-metadata review
above for the current working tree; CI must still scan the pushed revision.

## 2026-10-30 — Version-bump review stability

Run `41043886139` analyzed commit `924cdf4` successfully, but the review gate
rejected the analysis-input digest. The application had been bumped from
`0.30.0` to `0.30.1` after the previous review. Reconstructing only the three
package/lockfile version values recovered the exact previously reviewed digest;
dependencies, scripts and all other analysis inputs were unchanged.

The input identity now validates package SemVer and lockfile synchronization
before normalizing exactly `package.json.version`, `package-lock.json.version`
and `package-lock.json.packages[""].version`. These two root JSON documents are
serialized consistently, so whitespace-only formatting is also ignored. All
other metadata, dependency versions/ranges/integrity/download URLs, npm scripts
and source/configuration files remain part of the digest. Finding locations,
counts, rationales and source-file hashes remain exact; the bump command never
updates or approves review entries.

All 36 gate regression cases passed, including real patch/minor/major helper
calls, Git staging, JSON formatting, changed dependencies/scripts and rejection
of invalid or inconsistent version metadata. Release-version regressions,
version synchronization and Biome also passed.

Repeated the full security-extended scan with CLI 2.27.3 and JavaScript queries
2.4.8 after changing the identity calculation: the same 13 findings remain,
with identical locations/counts and source hashes. Verified all 293 analysis
inputs against the scan snapshot and rebound the existing reviews to normalized
digest `30317e3938a66e173bf7ee3a35abe138a1784dc448b4ceb0bb3a8166abc556ce`.
The exact review gate passes; no findings were added to the exception list.
SARIF, logs and a per-file source manifest are retained locally under
`output/playwright/version-bump-codeql/` (ignored by Git).

## 2026-10-30 — Static share metadata review

Compared all 293 analysis inputs with the per-file manifest from the full
version-bump scan. Only `index.html` changed: 18 static `meta`/canonical `link`
lines for the public production origin. Removing that block reproduces the
previous file byte-for-byte; executable code, CSP, dependencies and every
reviewed finding source hash are unchanged. The new artwork is a PNG rendered
from an SVG containing local map/icon references and text, without scripts.

Rebound the same 13 exact reviews to
`be7c243006a7d3e80dd2728f7c35aef1b32ffac199364e0a5acbfd424d1de363`.
The gate passes against the previous full SARIF. This is a focused static
metadata review, not a new full scan; CI must still analyze the pushed revision.
The isolated production build and build-output checks passed. A raw HTTP crawler
check verified matching OG/Twitter descriptions and HTTPS image URLs, a served
PNG with HTTP 200 and `image/png`, and its actual 1200 × 630 dimensions. The
artwork was also inspected in Chromium. No deployment or push was performed.

## 2026-10-30 — Community links review

The only analysis-input changes are four static HTML lines linking to this
fork's GitHub repository/issue form and three literal translated labels.
Removing those additions reconstructs the previously reviewed files exactly;
the full 293-file normalized identity then matches the prior review. The links
use fixed HTTPS destinations and `noopener noreferrer`; there are no new message
handlers, request paths, input processing or executable functions. Styling and
documentation changes do not affect the analyzed logic.

Rebound the unchanged 13 exact reviews to
`78dde778683a149e87e45bec7bf1a67e9a346207c7223eb063dea9f70058274a`.
The existing full SARIF passes the gate. This is a focused static UI/data review;
CI must still analyze the pushed revision. Translation checks, lint and the
isolated build passed. Chromium checks covered English at 1280 px, Ukrainian
at 360 px and Russian at 320 px, including visible/clickable links, destinations
and safe new-tab attributes. No push or deployment was performed.
