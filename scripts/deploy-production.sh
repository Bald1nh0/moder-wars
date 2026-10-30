#!/usr/bin/env bash
# Deploy a verified immutable image; retain the last healthy release for rollback.
set -Eeuo pipefail
umask 077

usage() {
  echo "Usage: $0 ghcr.io/owner/image@sha256:DIGEST [deployment-directory]" >&2
  exit 2
}
[[ $# -ge 1 && $# -le 2 ]] || usage
image=$1
[[ $image =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]] || usage
deploy_dir=${2:-"$HOME/moder-wars-production"}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source_compose="$script_dir/../docker/compose.production.yaml"
[[ -f $source_compose ]] || { echo "Missing bundled production Compose file." >&2; exit 1; }
command -v flock >/dev/null
command -v docker >/dev/null
docker compose version >/dev/null
docker info >/dev/null
mkdir -p -- "$deploy_dir"
deploy_dir=$(cd -- "$deploy_dir" && pwd)
exec 9>"$deploy_dir/.deploy.lock"
flock -n 9 || { echo "Another deployment is already running." >&2; exit 1; }

# Docker Compose must resolve configuration from these files, not caller overrides.
unset MW_IMAGE MW_BIND_ADDRESS MW_PORT COMPOSE_FILE COMPOSE_PROJECT_NAME
if [[ ! -f $deploy_dir/runtime.env ]]; then
  printf 'MW_BIND_ADDRESS=127.0.0.1\nMW_PORT=4174\n' > "$deploy_dir/runtime.env"
fi
previous=0
if [[ -f $deploy_dir/.env && -f $deploy_dir/compose.yaml && -f $deploy_dir/deployed.runtime.env ]]; then
  previous=1
elif [[ -e $deploy_dir/.env || -e $deploy_dir/compose.yaml || -e $deploy_dir/deployed.runtime.env ]]; then
  echo "Incomplete release metadata; restore it before deploying." >&2
  exit 1
elif [[ -n $(docker ps -aq --filter label=com.docker.compose.project=modern-wars-production) ]]; then
  echo "Production containers exist without release metadata; restore metadata before deploying." >&2
  exit 1
fi

work=$(mktemp -d "$deploy_dir/.release.XXXXXXXX")
mutated=0
committed=0
compose() {
  local file=$1 env_file=$2 runtime_file=$3
  shift 3
  docker compose --project-name modern-wars-production --env-file "$runtime_file" --env-file "$env_file" -f "$file" "$@"
}
cleanup() {
  local result=$?
  trap - EXIT HUP INT TERM
  set +e
  if (( mutated && ! committed )); then
    echo "Deployment failed; restoring the previous release." >&2
    if (( previous )); then
      if compose "$work/old.compose.yaml" "$work/old.env" "$work/old.runtime.env" up -d --no-build --pull never --wait --wait-timeout 120; then
        if ! { cp -- "$work/old.compose.yaml" "$deploy_dir/compose.yaml" &&
          cp -- "$work/old.env" "$deploy_dir/.env" &&
          cp -- "$work/old.runtime.env" "$deploy_dir/deployed.runtime.env"; }; then
          echo "ROLLBACK METADATA RESTORE FAILED. The previous container is healthy, but restore release metadata from $work before deploying again." >&2
          # A partial metadata restore must never discard the recovery files.
          exit 1
        fi
        echo "Previous release is healthy again." >&2
      else
        echo "ROLLBACK FAILED. Inspect Docker logs and the saved release metadata in $work." >&2
        # Preserve all recovery files if automated rollback fails.
        exit 1
      fi
    else
      if ! compose "$work/compose.yaml" "$work/image.env" "$work/runtime.env" down --timeout 10; then
        echo "Failed to remove the unsuccessful first deployment; inspect $work." >&2
        exit 1
      fi
      rm -f -- "$deploy_dir/compose.yaml" "$deploy_dir/.env" "$deploy_dir/deployed.runtime.env"
      echo "Unsuccessful first deployment removed; no previous release existed." >&2
    fi
    result=1
  fi
  rm -rf -- "$work"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

cp -- "$source_compose" "$work/compose.yaml"
cp -- "$deploy_dir/runtime.env" "$work/runtime.env"
printf 'MW_IMAGE=%s\n' "$image" > "$work/image.env"
release_changed=1
if (( previous )); then
  cp -- "$deploy_dir/compose.yaml" "$work/old.compose.yaml"
  cp -- "$deploy_dir/.env" "$work/old.env"
  cp -- "$deploy_dir/deployed.runtime.env" "$work/old.runtime.env"
  # Reruns still validate health, but must not erase the previous rollback target.
  # Configuration changes are a new release even when the image digest is unchanged.
  if cmp -s "$work/compose.yaml" "$work/old.compose.yaml" &&
    cmp -s "$work/image.env" "$work/old.env" &&
    cmp -s "$work/runtime.env" "$work/old.runtime.env"; then
    release_changed=0
  fi
fi
compose "$work/compose.yaml" "$work/image.env" "$work/runtime.env" config --quiet
# Pull failures leave the running container and committed metadata untouched.
compose "$work/compose.yaml" "$work/image.env" "$work/runtime.env" pull game
mutated=1
compose "$work/compose.yaml" "$work/image.env" "$work/runtime.env" up -d --no-build --pull never --wait --wait-timeout 120
if (( previous && release_changed )); then
  cp -- "$work/old.compose.yaml" "$deploy_dir/previous.compose.yaml"
  cp -- "$work/old.env" "$deploy_dir/previous.env"
  cp -- "$work/old.runtime.env" "$deploy_dir/previous.runtime.env"
fi
cp -- "$work/compose.yaml" "$deploy_dir/compose.yaml"
cp -- "$work/image.env" "$deploy_dir/.env"
cp -- "$work/runtime.env" "$deploy_dir/deployed.runtime.env"
committed=1
printf 'Healthy production release: %s\n' "$image"
