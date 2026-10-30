# Docker production deployment

Production is served at <https://modern-wars.bald1nh0.net/>. Local checks use
port **4180**, with a separate internal Docker deployment for shared development
testing. No private development URL belongs in the README.

The owner resumed production pipeline testing and merged the integration on
2026-10-30. Successful pushes to `main` publish and deploy automatically after
checks pass. Upstream licensing remains a separate unresolved question tracked
in [issue #5](https://github.com/Vaspyyy/moder-wars/issues/5); resuming deployment
is not evidence of a license grant.

The `dev` branch has an independent internal deployment on the same host:
[development setup](DEPLOYMENT-DEV.md). It uses a separate image package,
Compose project, directory, port and GitHub environment. The production flow
below remains specific to `main`.

## Release flow

1. Develop on `dev` or feature branches targeting it. Test the internal dev
   deployment, then open a PR from reviewed `dev` changes into `main`.
2. GitHub-hosted runners run `npm run check`, deployment regression checks,
   a Docker build, container health/HTTP checks, Trivy, npm advisory, full-history
   secret and CodeQL analysis checks. All must pass before publication. Fixable
   HIGH and CRITICAL image vulnerabilities and matching secret findings fail CI.
3. A successful **push to `main`** publishes the checked image to `ghcr.io/bald1nh0/moder-wars:sha-<COMMIT_SHA>`
   and `:v<VERSION>`. A draft GitHub Release records the exact commit and image.
   Deployment uses the immutable `@sha256:...` digest. PRs and manual workflow
   dispatches never publish or deploy.
4. The self-hosted runner labeled `mw` runs only the deployment job in this
   workflow. It pulls the image and runs Compose directly on the Docker host.
   Node, npm and a source build are not needed on production.
5. Compose waits up to 120 seconds for container health. A failed upgrade
   restores the previous image, Compose configuration and runtime settings;
   the workflow still fails so the failed release remains visible.
6. After healthy deployment, publish GitHub Release `v<VERSION>`. Versions with
   a suffix such as `-rc.1` are marked as prereleases. Failed deployments leave
   a draft, not a public announcement of a successful release.
7. Plan registry retention. Deletion requires the separate repository variable
   `REGISTRY_CLEANUP_ENABLED=true`; otherwise the job logs a dry-run plan.

## Versions and release contents

Follow [Semantic Versioning](https://semver.org/): PATCH for compatible fixes,
performance/security corrections; MINOR for compatible new features; MAJOR for
incompatible changes to a stable public contract. Before 1.0, this project uses
MINOR for breaking changes and documents migration; 1.0 marks the first supported
stable contract. Relevant contracts include scenario import/export, settings
and the simulation protocol. A large code diff alone is not a major release.

Use one helper to update package metadata, both lockfile version fields, the
page title and service-worker cache version together:

```sh
npm run version:bump -- patch
# Alternatives: minor, major, or an explicit version, e.g. 0.30.0-rc.1.
npm run version:check
```

Run only the bump appropriate to the change, then update `CHANGELOG.md` under
the release version and current date. The helper does not commit, push or tag.
As with npm, `patch` promotes `0.30.0-rc.1` to `0.30.0`; use an explicit version
to advance a prerelease counter. Build metadata (`+...`) is rejected because
Docker tags cannot represent it directly. CI rejects mismatched version markers.

The same version identifies the application, OCI version label, Docker tag
`v<VERSION>` and GitHub tag/release `v<VERSION>`. Every new releasable commit needs
an unused version; reusing a version with another commit/digest fails. A retry
with an existing release manifest reuses its original digest and re-scans it,
instead of silently replacing the release with a new build of the same commit.
If health passes but publishing the release fails, the healthy container remains
running; retry the workflow to finish publication.

The release contains notes and **`release-manifest.json`**, including version,
commit SHA, image tag and exact image digest. The container stays in GHCR; it is
not duplicated as a large tar attachment. The Docker tar passed between CI jobs
is a temporary Actions artifact retained for three days. Use the release's
digest for a reproducible pull rather than relying on a moving `latest` tag.
No `latest`, major or minor aliases are published by this workflow.

The previous Pages workflow is replaced. This is a single-container deployment,
so replacement can briefly interrupt HTTP requests. It is not a rolling update
or a saved-game migration. Existing browser sessions retain their own simulation;
reloading still discards a battle. Old hashed assets are not retained across
container releases, so an old tab may need a reload for a newly requested asset.

The Dockerfile pins the base image and targeted Alpine security fixes. When
updating these pins, rebuild and repeat the image scan; do not suppress findings
just to make a release pass. The vulnerability gate uses the scanner's current
database, so a previously passing image can need updates later.

## Runner setup

Use **Settings → Actions → Runners → New self-hosted runner** in this repository.
Follow GitHub's current Linux x64 commands in a dedicated directory, register
with label **`mw`**, and install/start its service as an unprivileged user:

```sh
sudo ./svc.sh install ubuntu
sudo ./svc.sh start
```

The workflow selects `[self-hosted, linux, x64, mw]`. Keep the runner current;
the pinned checkout action requires a current Actions runner. Its service user
needs Git, Bash, `flock`, Docker Engine and Docker Compose with `up --wait` support,
access to the Docker daemon without interactive sudo, and outbound HTTPS access
to GitHub and GHCR. No inbound GitHub connection or deployment SSH key is needed.

A runner registered to another repository cannot be shared by simply reusing
its label. Register a second runner in a separate directory/service on that
machine, or use an organization runner with selected repository access if both
repositories belong to that organization. This repository belongs to a personal
account, so the dedicated repository registration is appropriate.

**Public repository precaution:** this runner has production Docker access.
An external PR can add a workflow targeting its label, bypassing the conditions
and environment in our existing workflow. In **Settings → Actions → General →
Fork pull request workflows**, require approval for **all outside collaborators**.
Never approve an untrusted workflow targeting this runner. Main-only environment
rules and job `if` expressions do not isolate the machine from arbitrary PR
workflows. A private deployment repository or isolated deployment runner is the
stronger separation if accepting untrusted contributions becomes routine.

References: [runner registration](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners),
[organization runner access](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access),
[self-hosted runner security](https://docs.github.com/en/actions/reference/security/secure-use).

## GitHub configuration

1. If Actions is disabled for this fork, enable it in the Actions tab.
2. Create **Settings → Environments → production**. Set deployment branches to
   **Selected branches and tags** and allow the branch `main` only. The dedicated
   runner label `mw` selects the deployment host; no hostname variable is needed.
3. Protect `main` with a PR requirement and the required checks listed below.
   Avoid direct development pushes to `main`.
4. Ensure Actions can publish packages. The publish job requests `packages: write`
   and the deploy job `packages: read` using the automatically issued
   `GITHUB_TOKEN`; no long-lived registry password is needed. If the GHCR package
   already exists, grant this repository Actions access in the package settings.
   Registry login uses a temporary Docker config removed at the end of the step.
5. Confirm runner `mw` is online and has the `mw` label before merging.

No repository or environment variables are required to publish or deploy.
Pushes to `dev` deploy development; pushes to `main` deploy production. All
checks, branch/environment restrictions and release identity checks still apply.
The optional registry-cleanup variable controls deletion only and never blocks
publication or deployment.

The workflow creates release tags but does not choose/bump application versions.
Use the version helper before merging a release.

## Security controls and remaining setup

Keep one public repository with owner-reviewed contributions. This is a
deliberate operational compromise: the production runner is not isolated from
other workflows in the repository. Do not describe approval rules as a sandbox.

### GitHub settings (not configured by committing these files)

First configure **Actions → Policies** with an **Active** workflow execution
policy covering **all workflows, including future workflows**. Under **Restrict
actors**, allow only the user `Bald1nh0`. Under **Restrict events**, allow the
events used here: `push`, `pull_request`, `workflow_dispatch`, and `schedule`.
Do not scope this control only to the existing YAML filename: a proposed new
workflow must also be covered. This administrative allowlist cannot be removed
by editing a PR's YAML. Check **Policy insights** to confirm blocked attempts.

Owner-only execution also blocks external/Dependabot-triggered CI; do not add
every bot/contributor to the allowlist just to get a green PR. Review a proposed
change before deliberately running it through an owner-controlled branch or
dispatch. Do not assume approving/re-running someone else's run changes the
actor used by policy evaluation. Owner-triggered execution of untrusted code
is still unsafe on production. Policies constrain admission, not process access.
The available GitHub integration cannot configure this policy; activation is a
remaining administrator step. See [workflow execution policies](https://docs.github.com/en/actions/how-tos/administer/control-workflow-execution).

1. In **Actions → General**, select **Require approval for all external
   contributors** and save. Review the complete diff before **Approve and run**,
   including workflows, npm scripts, tests, imported modules and Docker inputs.
   Never approve a fork workflow targeting `self-hosted`/`mw`. Do not add a
   `pull_request_target` workflow that checks out or executes PR-controlled code;
   that event does not provide the same fork-approval boundary.
2. Keep repository write access restricted to trusted maintainers. This fork's
   owner is `Bald1nh0`; external contributors use fork PRs. External-contributor
   approval settings do not constrain trusted repository members in the same way.
3. Protect `main`: require a PR, passing `check`, `source-security` and `codeql`
   jobs, current-base checks, resolved conversations, and Code Owner review.
   Dismiss stale approvals after new commits; block force pushes and deletion.
   `.github/CODEOWNERS` assigns **all files** to `@Bald1nh0`, including itself,
   because application code and build inputs can also execute during CI.
   It only becomes effective after reaching the PR base branch and enabling
   required Code Owner review; it does not block editing files in a fork.
4. For a sole maintainer, own PRs cannot receive a self-approval. Either use a
   second trusted reviewer or retain a narrowly controlled owner/admin bypass
   for merging own PRs **after** all checks and personal review. A bypass also
   weakens enforcement; never use it to skip failed security checks or push
   directly to `main`. Other contributors must not receive that bypass.
5. Keep the default workflow token read-only and disable **Allow GitHub Actions
   to create and approve pull requests**. The checked-in jobs request elevated
   permissions only for their specific tasks. Do not provide long-lived PATs
   or production SSH keys to public PR jobs.
6. In **Advanced Security**, enable the dependency graph, Dependabot alerts and
   security updates, and private vulnerability reporting. Verify secret scanning
   and repository push protection. Use the workflow's advanced CodeQL
   setup instead of enabling a competing default CodeQL setup. Resolve existing
   alerts; enabling scans does not remove a leaked credential. Rotate a real
   exposed credential before considering history cleanup.

Before publication, verify these settings in GitHub. The available integration
can read repository rulesets but cannot change administrative settings; the
2026-10-29 ruleset read returned an empty list and branch-protection inspection
returned HTTP 403, so classic branch protection was not certified. The earlier
fork-approval screenshot showed first-time contributors only; a saved change to
all external contributors still needs confirmation. The latest Advanced Security
screenshot confirms the dependency graph, Dependabot alerts/security updates and
private vulnerability reporting enabled. Later screenshots confirm Secret
Protection and repository Push protection enabled; advanced CodeQL ran in PR #2.
The ruleset screenshots show configuration in progress, not proof of saved rules. Local
`dependabot.yml` takes effect only after it reaches the default branch; it does
not enable all these settings itself.

### Source and image checks

Hosted jobs check npm advisories (including build dependencies), scan fetched
Git history for secrets with redacted output, and analyze JavaScript/TypeScript
with CodeQL. Security failures block image publication, not merely a report
upload. Pinned scanner/action updates are reviewed like other executable code.
Keep the final-image Trivy scan as a separate control. No scanner proves that
the application is free of vulnerabilities.

CodeQL findings require triage, including false positives. Reviewed false
positives in `.github/codeql-reviewed.json` are matched by rule, file, exact
location range, occurrence count and SHA-256 of the entire source file, with a
written rationale. They also bind to a digest of all versioned/nonignored source,
dependency and configuration inputs, so changing a caller or validator elsewhere
invalidates an old review. New findings, changed inputs, missing results and
stale reviews fail the gate.
PR analysis explicitly disables `CODEQL_ACTION_DIFF_INFORMED_QUERIES` so the
report includes unchanged code, just like local and main-branch scans. A
diff-filtered report cannot validate the complete reviewed finding set and is
rejected. Keep this setting when updating the pinned CodeQL action.
These entries do not disable any query or hide results from GitHub code scanning.
Do not regenerate hashes or approve a baseline without repeating the relevant
security review. Scan findings can remain visible in GitHub despite a passing
local gate; dismiss them individually there only after the same review.
The [2026-10-29 remediation review](CODEQL-REMEDIATION.md) records the local
47-to-13 full-scan reduction and distinguishes remaining reviewed findings from
the PR's open-alert count. It does not authorize publication or alert dismissal.

### Network and HTTP verification

The administrator reports router exposure limited to ports 80/443, no external
SSH forwarding, and no initiation from the deployment subnet into the main
LAN. These are reported controls, not independently audited router rules.
UFW being inactive alone does not establish Internet exposure. Before cutover,
confirm the actual destination of both forwarded ports and any IPv6 rules.
Allow game port 4174 from the reverse proxy, SSH from management sources, and
9100 from the monitoring collector. Test both allowed and denied paths; keep a
console/rollback route before modifying ACLs. Docker port filtering must be
checked at the forwarding/network boundary, not only with UFW INPUT rules.

Nginx sends HTTP anti-framing CSP, X-Frame-Options, nosniff and a referrer policy
on normal and error responses. The meta CSP continues restricting scripts,
workers and service connections; the HTTP policy supplements it. CI verifies
headers, caching and binary asset responses in an isolated container. After
release, verify the same headers through HTTPS/Traefik and load a scenario.
Existing production is unchanged until an explicitly authorized release/cutover.

References: [fork approvals](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository),
[Code Owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners),
[security settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-security-and-analysis-settings-for-your-repository).

## Registry retention

After a successful release, the hosted cleanup job lists all GHCR package
versions and preserves:

- The 20 newest versions and every version younger than 30 days.
- The current production digest and the preceding healthy digest, read from
  deployment metadata. Missing protected digests or incomplete API responses
  stop cleanup before deletion.
- Explicit `keep-*` tags, unknown/custom tags and untagged manifests. Untagged
  manifests are kept conservatively because they may be children of multiarch
  images; this policy is not a total storage cap.

Among remaining old versions, only managed `sha-<COMMIT>`/SemVer tags are eligible.
Delete at most 10 versions per run, oldest first. Metadata is checked again before
deletion; API/permission errors stop further requests. Stable releases are also
eligible once outside retention: their GitHub release notes and JSON remain, but
the referenced image may no longer be available. Add a `keep-*` tag to an image
that needs long-term retention before it becomes eligible.

**Deletion is destructive.** The default is dry-run; review its log before setting
repository variable `REGISTRY_CLEANUP_ENABLED=true`. This does not delete Git tags
or GitHub Releases and does not prune Docker's local image cache on the host.
Do not use blanket `docker system prune` as a substitute: local rollback images
must remain available. A manual rollback older than the saved previous release
requires checking image availability first.

The job requests `packages: write`; deletion with `GITHUB_TOKEN` also requires
the repository to have **admin access to the package**. Workflow-created packages
normally grant this automatically; existing packages may need Actions access
configured. Public versions with more than 5,000 downloads cannot be deleted
through the normal API. See [GitHub package permissions](https://docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows/publishing-and-installing-a-package-with-github-actions)
and [package deletion rules](https://docs.github.com/en/rest/packages/packages).

## Prepare the Docker host

The CI deployment initializes a missing runtime configuration outside the
checkout, under the **runner service user's** home directory:

| Profile | Directory | Default bind address | Port |
| --- | --- | --- | --- |
| Production | `~/moder-wars-production` | `192.168.30.17` | `4174` |
| Development | `~/moder-wars-dev` | `192.168.30.17` | `4180` |

No manual `runtime.env` creation is required for the first CI deployment. The
workflow preserves an existing file, including an older loopback binding; check
it if the reverse proxy cannot reach an already configured installation. Runtime
changes apply on the next successful deploy. Restrict access to the published
ports through the existing network/firewall.

Verify Docker access as the runner service user:

```sh
docker info >/dev/null
docker compose version
```

For direct manual invocation outside CI, the deployment script still defaults
a missing runtime configuration to loopback. Use the host-local `runtime.env`
for deliberate overrides; do not copy runtime or rollback files between profiles.

The Compose project is **`modern-wars-production`**; it is separate from the old
`moder-wars-playtest` project. The image has no source mounts, and Nginx runs
unprivileged with a read-only filesystem, bounded logs and an HTTP health check.

## Initial cutover

Preparing or merging these files does not change the existing reverse proxy.
After the first successful main deployment:

1. Verify the new container is healthy and its published HTTP port serves the
   expected game version from the proxy machine.
2. Point the existing HTTPS proxy upstream to the new Docker host and port.
3. Verify the public domain, scenario loading and browser-worker gameplay.
4. Keep the previous production host/image available until validation succeeds.
   Reverting the upstream restores the old host if the initial cutover fails.

Container health verifies Nginx and the index response, not browser gameplay,
TLS or reverse-proxy connectivity. A successful deploy job alone does not verify
those external parts. The static production image does not serve the experimental
Node/WebSocket simulation backend.

## Inspect and recover

Run from the production instance as the runner service user:

```sh
cd "$HOME/moder-wars-production"
docker compose --env-file deployed.runtime.env --env-file .env ps
docker compose --env-file deployed.runtime.env --env-file .env logs --tail 100 game
```

The current healthy release uses `.env`, `compose.yaml` and
`deployed.runtime.env`. The immediately preceding successful release uses
`previous.env`, `previous.compose.yaml` and `previous.runtime.env`. Do not prune
these images while they are rollback candidates. `runtime.env` contains desired
settings; `deployed.runtime.env` records the settings actually running.

Prefer reverting the faulty commit through a PR, then merging to `main`, which
repeats checks and deployment. For an urgent manual rollback, stop issuing new
releases, take the same deployment lock and restore the saved release:

```sh
cd "$HOME/moder-wars-production"
(
  set -e
  flock -n 9
  docker compose --project-name modern-wars-production \
    --env-file previous.runtime.env --env-file previous.env \
    -f previous.compose.yaml up -d --no-build --pull never --wait --wait-timeout 120
  cp previous.compose.yaml compose.yaml
  cp previous.env .env
  cp previous.runtime.env deployed.runtime.env
) 9>.deploy.lock
```

Review `runtime.env` after rollback so a later release does not reapply an unwanted
bind/port change. If automated rollback itself fails, the script preserves its
`.release.*` recovery directory and prints its path. Restore a healthy container
and its matching metadata before resuming deployments. A failed first deployment
has no previous release and removes only its unsuccessful Compose project.

Local deployment validation does not touch running Docker services:

```sh
bash -n scripts/deploy-production.sh scripts/deploy-production-smoke.sh
bash scripts/deploy-production-smoke.sh
node scripts/release-version-smoke.mjs
node scripts/github-release-smoke.mjs
node scripts/registry-cleanup-smoke.mjs
actionlint
```
