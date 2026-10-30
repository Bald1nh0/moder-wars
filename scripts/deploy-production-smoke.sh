#!/usr/bin/env bash
# Exercise deployment transitions without contacting a registry or a Docker daemon.
set -Eeuo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/bin"
cat > "$fixture/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$MOCK_STATE/commands"
case "$1" in
  info) exit 0 ;;
  ps)
    [[ ${MOCK_ORPHAN:-0} == 0 ]] || echo orphan-container
    if [[ -n ${MOCK_ORPHAN_PROJECT:-} && "$*" == *"label=com.docker.compose.project=$MOCK_ORPHAN_PROJECT"* ]]; then echo orphan-container; fi
    exit 0 ;;
  compose) shift ;;
  *) exit 99 ;;
esac
[[ ${1:-} != version ]] || exit 0
image=''
project=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-name) [[ $2 == modern-wars-production || $2 == modern-wars-dev ]]; project=$2; shift 2 ;;
    --env-file)
      value=$(sed -n 's/^MW_IMAGE=//p' "$2")
      [[ -z $value ]] || image=$value
      shift 2 ;;
    -f) [[ -f $2 ]]; shift 2 ;;
    *) break ;;
  esac
done
active="$MOCK_STATE/active"
[[ $project != modern-wars-dev ]] || active="$MOCK_STATE/active-dev"
case "$1" in
  config) [[ -n $image ]] ;;
  pull) [[ ${MOCK_PULL_FAIL:-0} == 0 ]] ;;
  up)
    [[ "$*" == *'--wait --wait-timeout 120'* ]]
    [[ "$*" == *'--no-build --pull never'* ]]
    printf '%s\n' "$image" > "$active"
    [[ ${MOCK_FAIL_IMAGE:-} != "$image" && ${MOCK_ALL_UP_FAIL:-0} == 0 ]] ;;
  down) rm -f "$active" ;;
  *) exit 98 ;;
esac
MOCK
MOCK_REAL_CP=$(command -v cp)
export MOCK_REAL_CP
cat > "$fixture/bin/cp" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ ${1:-} != -- ]] || shift
if [[ -n ${MOCK_RESTORE_FAIL:-} && $1 == */"$MOCK_RESTORE_FAIL" ]]; then
  case "$2" in
    "$MOCK_STATE/production deployment/compose.yaml"|"$MOCK_STATE/production deployment/.env"|"$MOCK_STATE/production deployment/deployed.runtime.env")
      echo 'Simulated rollback metadata write failure.' >&2
      exit 1 ;;
  esac
fi
exec "$MOCK_REAL_CP" -- "$@"
MOCK
chmod +x "$fixture/bin/docker" "$fixture/bin/cp"
export PATH="$fixture/bin:$PATH"
printf -v old 'ghcr.io/example/modern-wars@sha256:%064d' 1
printf -v new 'ghcr.io/example/modern-wars@sha256:%064d' 2
count=0
check() { "$@" || { echo "FAIL: $*" >&2; exit 1; }; }
new_case() {
  count=$((count + 1))
  export MOCK_STATE="$fixture/case-$count"
  mkdir -p "$MOCK_STATE"
  destination="$MOCK_STATE/production deployment"
  unset MOCK_FAIL_IMAGE MOCK_PULL_FAIL MOCK_ALL_UP_FAIL MOCK_ORPHAN MOCK_RESTORE_FAIL MOCK_ORPHAN_PROJECT
}
deploy() { bash "$root/scripts/deploy-production.sh" "$@" > "$MOCK_STATE/output" 2>&1; }
fail_deploy() { if deploy "$@"; then cat "$MOCK_STATE/output" >&2; echo 'Expected deployment failure.' >&2; exit 1; fi; }
seed() {
  deploy "$old" "$destination"
  printf '# Previous release configuration\n' >> "$destination/compose.yaml"
}

new_case
deploy "$new" "$destination"
check grep -Fxq "$new" "$MOCK_STATE/active"
check grep -Fxq "MW_IMAGE=$new" "$destination/.env"
check test -f "$destination/deployed.runtime.env"
check test ! -f "$destination/previous.env"
echo 'PASS: first healthy deployment commits release metadata'

new_case
seed
# A configuration change is applied with the new release and retained separately.
printf 'MW_BIND_ADDRESS=0.0.0.0\nMW_PORT=8081\n' > "$destination/runtime.env"
deploy "$new" "$destination"
check grep -Fxq "$new" "$MOCK_STATE/active"
check grep -Fxq "MW_IMAGE=$old" "$destination/previous.env"
check grep -Fq 'Previous release configuration' "$destination/previous.compose.yaml"
check grep -Fxq 'MW_PORT=4174' "$destination/previous.runtime.env"
check grep -Fxq 'MW_PORT=8081' "$destination/deployed.runtime.env"
echo 'PASS: upgrade preserves the previous image, Compose configuration, and runtime settings'

new_case
deploy "$new" "$destination"
deploy "$new" "$destination"
check test "$(grep -c 'up -d' "$MOCK_STATE/commands")" -eq 2
check test ! -e "$destination/previous.env"
check test ! -e "$destination/previous.compose.yaml"
check test ! -e "$destination/previous.runtime.env"
echo 'PASS: repeating the first release checks health without creating a redundant rollback target'

new_case
seed
printf 'MW_BIND_ADDRESS=0.0.0.0\nMW_PORT=8081\n' > "$destination/runtime.env"
deploy "$new" "$destination"
rollback_before=$(sha256sum "$destination/previous.env" "$destination/previous.compose.yaml" "$destination/previous.runtime.env")
deploy "$new" "$destination"
check test "$(grep -c 'up -d' "$MOCK_STATE/commands")" -eq 3
check test "$rollback_before" = "$(sha256sum "$destination/previous.env" "$destination/previous.compose.yaml" "$destination/previous.runtime.env")"
check grep -Fxq "MW_IMAGE=$old" "$destination/previous.env"
echo 'PASS: repeating an upgrade checks health while preserving the exact previous rollback files'

new_case
deploy "$new" "$destination"
printf 'MW_PORT=8081\n' > "$destination/runtime.env"
deploy "$new" "$destination"
check grep -Fxq "MW_IMAGE=$new" "$destination/previous.env"
check grep -Fxq 'MW_PORT=4174' "$destination/previous.runtime.env"
check grep -Fxq 'MW_PORT=8081' "$destination/deployed.runtime.env"
echo 'PASS: changing runtime settings with the same image retains the old settings for rollback'

new_case
deploy "$new" "$destination"
printf '# Previous Compose configuration\n' >> "$destination/compose.yaml"
deploy "$new" "$destination"
check grep -Fxq "MW_IMAGE=$new" "$destination/previous.env"
check grep -Fq 'Previous Compose configuration' "$destination/previous.compose.yaml"
check test "$(grep -c 'Previous Compose configuration' "$destination/compose.yaml" || true)" -eq 0
echo 'PASS: changing Compose configuration with the same image retains the old configuration for rollback'

new_case
seed
export MOCK_FAIL_IMAGE=$new
printf 'MW_PORT=8081\n' > "$destination/runtime.env"
fail_deploy "$new" "$destination"
check grep -Fxq "$old" "$MOCK_STATE/active"
check grep -Fxq "MW_IMAGE=$old" "$destination/.env"
check grep -Fxq 'MW_PORT=4174' "$destination/deployed.runtime.env"
check grep -Fq 'Previous release configuration' "$destination/compose.yaml"
check grep -Fq 'Previous release is healthy again.' "$MOCK_STATE/output"
echo 'PASS: unhealthy upgrade restores the previous release and exits unsuccessfully'

new_case
seed
export MOCK_PULL_FAIL=1
fail_deploy "$new" "$destination"
check grep -Fxq "$old" "$MOCK_STATE/active"
check grep -Fxq "MW_IMAGE=$old" "$destination/.env"
check test "$(grep -c 'up -d' "$MOCK_STATE/commands")" -eq 1
echo 'PASS: registry failure never replaces the running release'

new_case
export MOCK_FAIL_IMAGE=$new
fail_deploy "$new" "$destination"
check test ! -f "$MOCK_STATE/active"
check test ! -f "$destination/.env"
check test -f "$destination/runtime.env"
echo 'PASS: unhealthy first deployment is removed without fabricating a rollback'

new_case
seed
export MOCK_ALL_UP_FAIL=1
fail_deploy "$new" "$destination"
check grep -Fq 'ROLLBACK FAILED' "$MOCK_STATE/output"
check test -n "$(find "$destination" -name old.env -print -quit)"
check grep -Fxq "MW_IMAGE=$old" "$destination/.env"
echo 'PASS: failed rollback preserves recovery files and reports failure'

for restore_file in old.compose.yaml old.env old.runtime.env; do
  new_case
  seed
  export MOCK_FAIL_IMAGE=$new MOCK_RESTORE_FAIL=$restore_file
  fail_deploy "$new" "$destination"
  check grep -Fxq "$old" "$MOCK_STATE/active"
  check grep -Fq 'Simulated rollback metadata write failure.' "$MOCK_STATE/output"
  check grep -Fq 'ROLLBACK METADATA RESTORE FAILED' "$MOCK_STATE/output"
  check test "$(grep -c 'Previous release is healthy again.' "$MOCK_STATE/output" || true)" -eq 0
  for saved in old.compose.yaml old.env old.runtime.env; do
    check test -n "$(find "$destination" -name "$saved" -print -quit)"
  done
  echo "PASS: rollback copy failure for $restore_file preserves every recovery file"
done

new_case
fail_deploy 'ghcr.io/example/modern-wars:latest' "$destination"
check test ! -f "$MOCK_STATE/commands"
echo 'PASS: mutable image tags are rejected before Docker is contacted'

new_case
mkdir -p "$destination"
printf 'MW_IMAGE=%s\n' "$old" > "$destination/.env"
fail_deploy "$new" "$destination"
check grep -Fq 'Incomplete release metadata' "$MOCK_STATE/output"
echo 'PASS: incomplete metadata is rejected'

new_case
export MOCK_ORPHAN=1
fail_deploy "$new" "$destination"
check grep -Fq 'containers exist without release metadata' "$MOCK_STATE/output"
echo 'PASS: unmanaged existing production containers are not overwritten'

new_case
mkdir -p "$destination"
exec 8>"$destination/.deploy.lock"
flock -n 8
fail_deploy "$new" "$destination"
check grep -Fq 'Another deployment is already running' "$MOCK_STATE/output"
flock -u 8
exec 8>&-
echo 'PASS: concurrent deployment is rejected'

# Both profiles share a host but never share projects, metadata or rollback state.
printf -v dev_old 'ghcr.io/bald1nh0/moder-wars-dev@sha256:%064d' 3
printf -v dev_new 'ghcr.io/bald1nh0/moder-wars-dev@sha256:%064d' 4

new_case
seed
prod_metadata=$(sha256sum "$destination/.env" "$destination/compose.yaml" "$destination/deployed.runtime.env")
dev_destination="$MOCK_STATE/dev deployment"
MW_PORT=4174 COMPOSE_PROJECT_NAME=modern-wars-production deploy "$dev_old" "$dev_destination" dev
check grep -Fxq "$old" "$MOCK_STATE/active"
check grep -Fxq "$dev_old" "$MOCK_STATE/active-dev"
check grep -Fxq 'name: modern-wars-dev' "$dev_destination/compose.yaml"
check grep -Fxq 'MW_PORT=4180' "$dev_destination/deployed.runtime.env"
check grep -Fxq 'MW_BIND_ADDRESS=127.0.0.1' "$dev_destination/deployed.runtime.env"
check test "$prod_metadata" = "$(sha256sum "$destination/.env" "$destination/compose.yaml" "$destination/deployed.runtime.env")"
deploy "$dev_new" "$dev_destination" dev
check grep -Fxq "MW_IMAGE=$dev_old" "$dev_destination/previous.env"
check grep -Fxq "$old" "$MOCK_STATE/active"
export MOCK_FAIL_IMAGE=$dev_old
fail_deploy "$dev_old" "$dev_destination" dev
check grep -Fxq "$dev_new" "$MOCK_STATE/active-dev"
check grep -Fxq "$old" "$MOCK_STATE/active"
check grep -Fxq "MW_IMAGE=$dev_new" "$dev_destination/.env"
check test "$prod_metadata" = "$(sha256sum "$destination/.env" "$destination/compose.yaml" "$destination/deployed.runtime.env")"
echo 'PASS: dev first deploy, upgrade and rollback never mutate production state'

new_case
seed
export MOCK_FAIL_IMAGE=$dev_new
fail_deploy "$dev_new" "$MOCK_STATE/dev deployment" dev
check test ! -f "$MOCK_STATE/active-dev"
check grep -Fxq "$old" "$MOCK_STATE/active"
echo 'PASS: an unhealthy first dev deployment removes only the dev project'

new_case
fail_deploy "$dev_new" "$destination" staging
check test ! -e "$destination"
check test ! -e "$MOCK_STATE/commands"
echo 'PASS: unknown profiles are rejected before directory or Docker operations'

new_case
fail_deploy "$new" "$destination" dev
check test ! -e "$destination"
check test ! -e "$MOCK_STATE/commands"
echo 'PASS: dev cannot deploy an image from the production or unrelated registry package'

for forbidden in 'MW_PORT=4174' 'COMPOSE_PROJECT_NAME=modern-wars-production' 'COMPOSE_FILE=production.yaml' 'MW_IMAGE=anything' 'MW_BIND_ADDRESS=$(touch unexpected)'; do
  new_case
  mkdir -p "$destination"
  printf '%s\n' "$forbidden" > "$destination/runtime.env"
  fail_deploy "$dev_new" "$destination" dev
  check test ! -f "$MOCK_STATE/active-dev"
  check test "$(grep -c 'pull game' "$MOCK_STATE/commands" || true)" -eq 0
  echo "PASS: dev rejects unsafe runtime setting ${forbidden%%=*} before pulling"
done

new_case
seed
fail_deploy "$dev_new" "$destination" dev
check grep -Fq 'another profile' "$MOCK_STATE/output"
check grep -Fxq "$old" "$MOCK_STATE/active"
# Older production releases have no marker, but their Compose name still identifies them.
rm "$destination/.deployment-profile"
fail_deploy "$dev_new" "$destination" dev
check grep -Fq 'Existing Compose project' "$MOCK_STATE/output"
check grep -Fxq "$old" "$MOCK_STATE/active"
echo 'PASS: marked and legacy production directories cannot become dev directories'

new_case
deploy "$dev_old" "$destination" dev
fail_deploy "$new" "$destination"
check grep -Fq 'another profile' "$MOCK_STATE/output"
check grep -Fxq "$dev_old" "$MOCK_STATE/active-dev"
echo 'PASS: a dev directory cannot be reused by the production profile'

new_case
export MOCK_ORPHAN_PROJECT=modern-wars-production
deploy "$dev_new" "$destination" dev
check grep -Fxq "$dev_new" "$MOCK_STATE/active-dev"
check grep -Fq 'label=com.docker.compose.project=modern-wars-dev' "$MOCK_STATE/commands"
echo 'PASS: unrelated production containers do not block a first dev deployment'

new_case
export MOCK_ORPHAN_PROJECT=modern-wars-dev
fail_deploy "$dev_new" "$destination" dev
check grep -Fq 'containers exist without release metadata' "$MOCK_STATE/output"
echo 'PASS: orphaned dev containers are rejected by their own project label'

printf 'All %s deployment smoke checks passed.\n' "$count"
