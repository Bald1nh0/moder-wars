# Deployment security review

Date: 2026-10-29. Branch: `feature/campaign-ai-planning`.

## Remediation status (2026-10-29, local changes)

The findings below preserve the initial audit evidence. The following status
supersedes their original descriptions of missing local controls:

| Finding | Local remediation | Remaining verification |
| --- | --- | --- |
| CI-TRUST-001 | Owner review for all files via `.github/CODEOWNERS`; documented owner-only, all-workflow execution policy, fork approvals and main protections | GitHub settings must be activated/verified by the administrator; the runner still has production authority and is not isolated |
| CI-COVERAGE-002 | Hosted npm audit, full-history redacted Gitleaks and CodeQL security-extended jobs gate publication; weekly checks and dependency update proposals | First GitHub run, account security features and scan outcomes; local results recorded below |
| JS-CSP-001 | HTTP framing CSP, XFO, nosniff and referrer headers with consistent inheritance; unsupported meta directive removed | Public HTTPS/proxy verification after an authorized release |
| Network verification | Recorded administrator-provided router/segmentation controls; repeated read-only host inspection | Confirm forwarding destinations, IPv6 policy and allowed/denied proxy, management and monitoring paths before cutover |

These changes do not make every row operationally closed: GitHub policy/main
protection and network/proxy verification are external steps, and the existing
production image has not received the new headers or application hardening.

### Verified controls and limits

- Isolated hardened Nginx validation passed for GET/HEAD and HTTP
  200/206/301/304/404, index/service-worker cache policy, JavaScript MIME and
  unchanged compressed map transport. `nginx -t` passed. The smoke test is
  wired into container CI. No public production container was replaced.
- `npm audit --package-lock-only --ignore-scripts --audit-level=high` reported
  zero known vulnerabilities, including development dependencies.
- Current tracked and nonignored untracked file contents passed Gitleaks;
  this working-tree check is separate from scanning committed history.
- The SARIF release gate rejects missing/malformed reports, unsuccessful scans
  and unreviewed findings. Exact reviewed false positives must match location,
  count, file hash and the complete analysis-input digest; a changed caller also
  invalidates review. Nineteen regression checks passed. Release/version, registry and
  deployment/rollback checks passed; actionlint and Biome passed.
- GitHub rulesets returned `[]`; classic branch-protection inspection returned
  403 due to integration permissions. Do not infer that classic protection is
  absent or enabled. The latest screenshots confirm dependency graph, Dependabot
  alerts/security updates and private vulnerability reporting enabled, CodeQL
  unconfigured, and an earlier screenshot
  showed only first-time-contributor workflow approval. Saved settings changes
  have not been independently verified.
- The administrator reports router exposure limited to 80/443, no public SSH,
  and no initiation from the deployment subnet into the main LAN. Host INPUT
  currently accepts traffic, UFW is inactive and the runner is active. These
  observations do not negate the router controls or prove Internet exposure.

### Source hardening discovered during verification

The initial CodeQL run analyzed 262 JavaScript/TypeScript files with 105
security-extended queries and produced 71 findings, not 71 proven exploits.
Triage led to the following additional safeguards:

- Reject prototype/method-shadowing keys in simulation transport and state
  cloning; construct typed views only through explicit built-in constructors.
- Validate country identities, equipment keys/quantities, restored cursors,
  simulation side indexes and influence-cell indexes before property writes.
- Restrict worker fetches to same-origin packaged assets, reject redirects and
  omit credentials; retain same-origin blob fallback for scenario restart.

Full curated smoke checks, typechecking and lint passed. Existing reference
tests were corrected to stop expecting invalid `undefined`/`NaN` array
properties, with explicit assertions that those properties are absent.
Real Chromium against an isolated built image loaded and reloaded Modern Day
2026, loaded a local blob fallback, rejected external/outside-assets requests
and rasterized packaged geography. Build-output/actual-worker lifecycle checks
passed. Evidence: `output/playwright/security-validation/result.json`.
Existing missing favicon/two legacy audio files and headless GPU warnings remain;
these are unrelated to the security changes and are not claimed fixed.

The final CodeQL scan analyzed **266/266 JavaScript/TypeScript files** with the
same 105 security-extended queries. It reports **47 reviewed false positives**:
35 generic property writes guarded by numeric bounds or safe data reconstruction,
one uint32 influence-map write, three non-security game random choices, five
dedicated-worker message handlers, two constrained worker asset fetches, and
the intentional release-notes upload. Each concrete location and rationale is
recorded in `.github/codeql-reviewed.json`; no rule or file was excluded.
The gate passed against the final SARIF with **zero unreviewed findings**.
This is not a claim of zero CodeQL alerts or complete application security.
Any change to analysis inputs invalidates the review digest and requires triage.

Full Git history including merge diffs was scanned (473 commits). The single
Gitleaks match was verified as encoded SVG flag content in historical scenario
`WW2 Peru Update.json`, `metadata[50].flagUrl`, commit
`469b44c75f2c735c92125ace3685d9af8ef55831`. `.gitleaksignore` records only the
exact finding fingerprint, not a rule/file/commit exclusion. No credential
value was printed and no history was rewritten.

GitHub now documents **Actions → Policies → Restrict actors** for public
repositories. An active policy targeting **all workflows**, allowing only
`Bald1nh0` and the intended events, is a stronger admission control than YAML
conditions or CODEOWNERS. It is configured outside proposed workflow code.
It also blocks external/bot-triggered CI; reviewed changes need an explicitly
owner-controlled execution path. The current integration has no policy-setting
capability. Owner-only admission still does not isolate a process once the owner
authorizes it, so CI-TRUST-001 is **mitigated by design, not fully closed**.

See [DEPLOYMENT.md](docs/DEPLOYMENT.md#security-controls-and-remaining-setup)
for the exact remaining administrator steps and
[GitHub workflow execution policies](https://docs.github.com/en/actions/how-tos/administer/control-workflow-execution).
The user authorized pushing the integration feature branch on 2026-10-29.
Main merges, release publication and production cutover remain on hold.

## Initial audit findings

## Executive summary

The proposed application container has a useful hardening baseline. The highest
priority issue is the trust boundary around the self-hosted runner: a public
repository can schedule code on the same machine intended to host production,
under a user with root-level Docker access. Environment restrictions and a
publication feature flag do not isolate that runner from another workflow.

This is a focused review of CI/CD, the Docker host and web response controls,
not a full application penetration test. No exploit was executed, no private
credentials were read, and no production configuration was changed. Source
changes remain local; publication is on hold pending licensing clarification.

## 1. High: public-repository runner has production host authority

**Rule:** CI-TRUST-001.

**Evidence:** `.github/workflows/check-and-deploy.yml:4` accepts PR events;
`:165` targets `[self-hosted, linux, x64, mw]`; `:196` executes the checked-out
deployment script. The runner is already registered, independently of whether
this proposed workflow has been merged. Read-only SSH inspection confirmed:

- Runner service `actions.runner.Bald1nh0-moder-wars.mw.service` is active as
  `ubuntu` on the deployment instance.
- `ubuntu` belongs to the `docker` group and `dockerd` runs as `root`.

**Impact:** If an untrusted workflow is admitted to this runner, it can use Docker
to obtain host-level access, modify production and access host-readable secrets.
An outside contributor does not need permission to push to `main` to propose a
workflow that targets the runner label. Whether that PR workflow actually runs
depends on GitHub's approval settings; those live settings were not verified.

The existing `main`, hostname and `production` checks protect the intended job.
A modified/new workflow can omit them. `USER nginx` protects the application
container, not the runner's access to the host Docker daemon. Merely moving a
runner with unrestricted production SSH credentials to another VM would retain
much of the same risk.

**Recommended fix:** register the production deployment runner to a separate,
private deployment repository with tightly controlled contributors and reviewed
deployment code. Keep public-repository PR checks on GitHub-hosted runners.
Design promotion of an approved image digest across that boundary explicitly;
do not execute public PR code in the private deployment workflow.

**Interim mitigation:** require approval for all outside-collaborator workflows
and inspect workflow changes before approval. This is an operational safeguard,
not isolation. Do not treat the absence of collaborators as runner protection.

Sources: [GitHub runner security](https://docs.github.com/en/actions/reference/security/secure-use),
[Docker group privileges](https://docs.docker.com/engine/install/linux-postinstall/).

## 2. Medium: image scanning does not cover the full source/dependency lifecycle

**Rule:** CI-COVERAGE-002. This is a control gap, not a confirmed vulnerable package.

**Evidence:** `.github/workflows/check-and-deploy.yml:64` scans the built container
with Trivy. `.dockerignore:1` excludes repository files except the Docker build
inputs and `dist`; `Dockerfile:8` copies the static build. The workflow has no
dedicated npm lockfile advisory check, JavaScript/TypeScript security analysis,
or repository/history secret scan. Bundling dependencies into browser JavaScript
does not guarantee a container scanner can identify their original npm versions.

**Impact:** vulnerable npm/build dependencies, unsafe application data flows or
secrets outside the packaged image can escape the existing image-only gate.

**Recommended fix:** add a lockfile/dependency advisory check or dependency review,
CodeQL for JavaScript/TypeScript, and repository secret scanning/push protection
where available. Review full Git history with a secret scanner before publication;
avoid printing any discovered credential values into CI logs. Retain Trivy for
the final image rather than replacing it with source-only checks.

**Verification:** `npm audit --json --ignore-scripts` completed successfully during
this review and reported **0 known vulnerabilities**. This is a dated advisory
check, not proof of the absence of application bugs or future vulnerabilities.
Account-level GitHub security features may already be enabled; their state was
not inspected, so this finding concerns visible workflow coverage.

Source: [CodeQL JavaScript/TypeScript coverage](https://docs.github.com/en/code-security/reference/code-scanning/codeql/codeql-queries/javascript-typescript-built-in-queries).

## 3. Low: anti-framing policy is present in an unsupported delivery location

**Rule:** JS-CSP-001.

**Evidence:** `index.html:6` includes `frame-ancestors 'none'` inside a CSP meta
element. `docker/nginx.conf:25` does not send an HTTP CSP or X-Frame-Options header.
A HEAD request to the current public production root returned HTTP 200 without
either header, X-Content-Type-Options or Referrer-Policy.

**Impact:** the intended anti-framing directive is ignored; another site may
embed the game and overlay controls. No sensitive-action exploitation was
demonstrated. Other supported directives in the meta CSP still apply; this is
not a claim that the application has no CSP at all.

**Recommended fix:** send `frame-ancestors 'none'` through an HTTP CSP header and
consider `X-Content-Type-Options: nosniff` and an explicit Referrer-Policy.
Validate actual responses at the proxy and Nginx levels, including index and
error responses. Preserve required worker, asset and community-service behavior;
test before moving the full CSP to headers. Do not weaken script policy to make
a change pass browser checks.

Source: [MDN frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors).

## Network checks still required before cutover

Read-only inspection found UFW inactive and SSH plus a listener on port 9100
bound on all interfaces. The prepared runtime configuration will publish game
HTTP on the private interface at port 4174; nothing was listening there yet.
`docker/compose.production.yaml:7` permits this host-specific bind configuration.
The supplied Traefik route still points to the old production instance and
references a CrowdSec middleware.

These observations do **not** establish internet exposure or absence of a
Proxmox/router firewall. Verify those upstream rules: SSH from the management
network, game HTTP from the proxy, and metrics from the monitoring collector.
Also check the middleware's actual operation. Enabling UFW alone is insufficient
evidence that Docker-published ports are filtered, because Docker's forwarding
rules interact with it differently from ordinary host listeners.

Source: [Docker firewall behavior](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

## Controls already present

- Non-root application user (`Dockerfile:10`), read-only filesystem, all
  capabilities dropped, no-new-privileges, bounded tmpfs and rotated logs
  (`docker/compose.production.yaml:9`). No Docker socket or source mount in the
  application container.
- Pinned action commits/base-image digest; `npm ci --ignore-scripts` and a locked
  dependency tree; default read-only workflow token permissions with separate
  publish/deploy/release/cleanup privileges.
- Temporary registry credentials and credential-free checkout configuration.
- Digest-based deployment, exact release identity checks, health-gated rollback,
  preservation of rollback metadata on identical retries, and dry-run cleanup.
- HTTPS terminates at Traefik. Static production does not expose the experimental
  Node/WebSocket simulation server or a production game database.
- Source inspection confirms escaping in sampled community chat/comment
  rendering paths. These samples are not a complete DOM-XSS review.

## Limits and next steps

Prioritize runner isolation, then source/dependency scanning, network restrictions
and response-header hardening. Review scenario import/export and community
authorization separately before treating them as audited. The experimental
server remains outside this production review and should remain LAN-only.

No GitHub rulesets, fork-workflow approvals, package permissions or network ACLs
were changed or certified by this review. The planned workflow is still local;
existing production continues running its earlier release.
