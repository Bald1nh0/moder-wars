# Internal development deployment

Development starts on branch `dev`, created from `origin/main` at `a06d943`
after PR #2 was merged. Use feature branches targeting `dev` when useful, and
promote reviewed changes from `dev` to `main` through a pull request.

The application uses the same numeric `X.Y.Z` version in dev and production.
Do not add experimental/RC suffixes or bump solely to promote tested changes.
Commit/run image tags distinguish dev builds; a published production version
must not be reused for different contents.

## Independent deployments on one host

| Setting | Production | Development |
| --- | --- | --- |
| Source branch | `main` | `dev` |
| GitHub environment | `production` | `development` |
| GHCR package | `bald1nh0/moder-wars` | `bald1nh0/moder-wars-dev` |
| Image tag | `v<VERSION>` and `sha-<COMMIT>` | `sha-<COMMIT>-run-<RUN>-<ATTEMPT>` |
| Compose project | `modern-wars-production` | `modern-wars-dev` |
| Runner home directory | `~/moder-wars-production` | `~/moder-wars-dev` |
| Host HTTP port | `4174` | `4180` |
| Proxy | Public Traefik | Internal Traefik |
| GitHub Release | After healthy deployment | None |

Both jobs use the existing `[self-hosted, linux, x64, mw]` runner on
`192.168.30.17`. The application is still the static Nginx image with browser
simulation; this does not deploy the experimental WebSocket simulation server.
The local development machine can continue using its own port 4180.

Pushes to `dev` run the same version checks, tests, build, container checks,
Trivy, npm audit, secret scanning and CodeQL gate as production. Only after all
three check jobs succeed can `publish-dev` and `deploy-dev` run. PRs, schedules
and manual dispatches check code only. They never deploy.

Development images are deployed by digest. Each run/attempt gets a unique tag
after checking the scanned artifact's revision/version labels, so a retry can
publish a new dev build without overwriting the previous tag. Development does
not overwrite production tags or create a Git tag/release. The separate dev
package is outside the production registry-cleanup script's scope. Dev retention
is not automated yet: preserve the current and previous digests recorded on the
host if manually retiring older dev images.

## One-time setup

1. Create GitHub environment **development**. Under deployment branches select
   **Selected branches and tags** and allow the branch **dev** only.
2. Keep runner `mw` online with Docker access. The same production runner is
   privileged; retain owner-only Actions execution policies and never allow
   unreviewed PR jobs to run on it. A separate container/project does not isolate
   arbitrary workflow code from the host or production Docker daemon.
3. Deploy the internal Traefik provider described below.
4. Push the reviewed `dev` branch. After checks pass, publication and deployment
   start automatically. The first dev publish creates the separate GHCR package.
   If the package already exists, grant this repository Actions access in the
   package settings; no long-lived registry token is required.

No GitHub deployment variables or hostname variables are required. The workflow
initializes a missing `~/moder-wars-dev/runtime.env` with bind address
`192.168.30.17` and port `4180`, using the runner service user's home directory.
It preserves an existing file; review that file if an older manual setup still
binds to loopback. Dev settings must use port 4180 and a literal bind address.
Do not copy production `.env`, Compose or rollback files into the dev directory.

Creating a local branch does not itself deploy a container or change DNS. A push
to `dev` is the deployment trigger; manual workflow dispatch only runs checks.

## Internal Traefik and DNS

The provider is in the sibling repository:
`traefik-internal/fileprovider/modern-wars-dev.yml`.

- Host: `modern-wars-dev.int.bald1nh0.net`.
- Backend: `http://192.168.30.17:4180`.
- Entrypoints: `http` and `https`; HTTP uses `redirect-to-https@file`.
- Certificate resolver: the internal proxy's existing `myresolver` DNS challenge.

The existing DNS wildcard `*.int.bald1nh0.net` points to the internal
Traefik at `192.168.31.181`, so this hostname uses that private proxy.
Deploy this provider file on that proxy only, not on `traefik-usource`.
Restrict proxy/backend reachability through the existing network firewall;
DNS and a private-looking hostname are not access controls. No new public
router forwarding is needed for DNS challenge certificates.

After `deploy-dev` reports healthy, verify from the internal proxy's network:

```sh
curl --fail --show-error http://192.168.30.17:4180/index.html -o /dev/null
curl --fail --show-error -I https://modern-wars-dev.int.bald1nh0.net/
```

Check the served version and security headers, then open the game and load a
scenario. Development and production use separate browser origins, so saved
preferences and service-worker caches do not share storage.

## Health and rollback

The deployment command is:

```sh
bash scripts/deploy-production.sh \
  'ghcr.io/bald1nh0/moder-wars-dev@sha256:<64-hex-digit-digest>' \
  "$HOME/moder-wars-dev" dev
```

The script selects `docker/compose.dev.yaml`, a separate deployment lock and
profile metadata. It refuses mixed production/dev directories and conflicting
dev runtime settings before replacing containers. Unhealthy upgrades restore
only the dev image/configuration. An unhealthy first deployment removes only
the failed dev project. Production remains independently managed.

For an urgent manual rollback, stop issuing dev deployments, inspect the saved
`previous.env`, `previous.compose.yaml` and `previous.runtime.env`, then restore
the previous healthy dev configuration under the same lock:

```sh
cd "$HOME/moder-wars-dev"
(
  set -e
  flock -n 9
  docker compose --project-name modern-wars-dev \
    --env-file previous.runtime.env --env-file previous.env \
    -f previous.compose.yaml up -d --no-build --pull never --wait --wait-timeout 120
  cp previous.compose.yaml compose.yaml
  cp previous.env .env
  cp previous.runtime.env deployed.runtime.env
) 9>.deploy.lock
```

Review desired `runtime.env` settings before the next deployment. Prefer a
reviewed revert on `dev` for normal recovery; do not use the production directory
or project for a dev rollback.

GitHub's [environment restrictions](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
and Traefik's [file provider](https://doc.traefik.io/traefik/providers/file/)
describe the underlying configuration mechanisms.

## Local validation — 2026-10-30

- Actionlint, Bash syntax, Biome, version synchronization and Compose validation
  passed for both profiles.
- All 30 deployment regression cases passed, including unchanged production
  behavior, dev/prod directory isolation and failed dev deployment/rollback.
- Release/version and registry-cleanup regressions passed. The extracted dev
  publish shell was exercised with a fake Docker CLI: valid artifacts publish;
  wrong commit/version labels fail before push. No registry mutation was made.
- All 22 published-digest regressions passed against the actual workflow shell,
  including a CI alias before the GHCR reference and absent/ambiguous matches.
- All 100 branch/event/repository routing and runtime-bootstrap checks passed
  without deployment variables, including preservation of existing host settings.
- The full CodeQL security-extended scan retained the same 13 reviewed findings
  with no new findings. The exact review gate and all 21 gate tests passed.
  Analysis input digest:
  `4b4e0163ef918bd610d8b3431276b980179701ae238c20e3960924bfe4d47bda`.
  Repeated after the single-source version/favicon change; local analysis
  artifacts: `output/playwright/version-branding/codeql/` (locally ignored by Git).
- Provider YAML and router/service/middleware references passed local validation;
  the hostname resolved to `192.168.31.181` from the development machine.

These are preparation checks, not a completed hosted dev deployment. No live
container/proxy was restarted; environment activation, a branch push and the
first end-to-end HTTPS/game check remain separate steps.
