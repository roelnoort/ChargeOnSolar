#!/usr/bin/env bash
#
# Deploys ChargeOnSolar on the NUC: builds and starts one commit of main, and
# rolls back to the commit that was running if the build fails or the
# container doesn't stay up. Spec: #64, #69.
#
# This is the SSH forced command of the NUC's `deploy` user, so whatever the
# client asks for, this runs. It reads the request from SSH_ORIGINAL_COMMAND
# and accepts only `deploy` (the head of main) or `deploy <sha>` (7 to 40
# lowercase hex digits). The NUC wizard installs it outside the git checkout,
# so a deploy can never rewrite the script it is running.
#
# Settings, overridable through the environment (sshd passes none of these
# from the client):
#   DEPLOY_PROJECT_DIR   the git checkout with compose.yaml  (/srv/chargeonsolar)
#   DEPLOY_WAIT_SECONDS  how long the container must stay up (60)
#   DEPLOY_LOCK          lock directory, one deploy at a time
#                        (/run/lock/chargeonsolar-deploy, cleared on reboot)
#
# Database migrations are not reversed on rollback; the server's
# pre-migration backup is the way back.

set -euo pipefail

project_dir=${DEPLOY_PROJECT_DIR:-/srv/chargeonsolar}
service=chargeonsolar
wait_seconds=${DEPLOY_WAIT_SECONDS:-60}
lock=${DEPLOY_LOCK:-/run/lock/chargeonsolar-deploy}
request=${SSH_ORIGINAL_COMMAND:-}

allowed='^deploy( [0-9a-f]{7,40})?$'
if [[ ! "$request" =~ $allowed ]]; then
  echo "Refused: only 'deploy' or 'deploy <sha>' is allowed." >&2
  exit 1
fi
requested=${BASH_REMATCH[1]# }
requested=${requested:-origin/main}

# mkdir is atomic, and unlike flock it also exists on the Macs that run the tests.
take_lock() {
  if ! mkdir "$lock" 2>/dev/null; then
    local holder
    holder=$(cat "$lock/pid" 2>/dev/null || true)
    if [[ -z "$holder" ]] || kill -0 "$holder" 2>/dev/null; then
      echo "Refused: another deploy is running (lock $lock, pid ${holder:-unknown})." >&2
      echo "If no deploy is running, remove $lock and try again." >&2
      exit 1
    fi
    echo "Removing the lock of deploy $holder, which is no longer running."
    rm -rf "$lock"
    if ! mkdir "$lock" 2>/dev/null; then
      echo "Refused: another deploy is running (lock $lock)." >&2
      exit 1
    fi
  fi
  trap 'rm -rf "$lock"' EXIT
  echo "$$" >"$lock/pid"
}
take_lock

cd "$project_dir"
if ! git fetch --quiet origin; then
  echo "Deploy failed: could not fetch from origin. Nothing changed." >&2
  exit 1
fi
if ! target=$(git rev-parse --verify --quiet "${requested}^{commit}") ||
  ! git merge-base --is-ancestor "$target" origin/main; then
  echo "Refused: $requested is not a commit on main." >&2
  exit 1
fi
previous=$(git rev-parse HEAD)
echo "Deploying $target (running now: $previous)."

switch_to() {
  git checkout --quiet --detach "$1" && docker compose up -d --build
}

roll_back() {
  local reason=$1
  echo "Deploy failed: $reason. Rolling back to $previous."
  if switch_to "$previous"; then
    echo "Rolled back to $previous: $reason."
  else
    echo "Rollback to $previous failed too: ChargeOnSolar may be down."
  fi
  exit 1
}

container_state() {
  local id
  id=$(docker compose ps -q "$service" 2>/dev/null || true)
  if [[ -z "$id" ]]; then
    echo "gone"
    return
  fi
  docker inspect --format '{{.State.Running}} {{.RestartCount}}' "$id" 2>/dev/null || echo "gone"
}

switch_to "$target" || roll_back "$target could not be checked out or built"

state_at_start=$(container_state)
sleep "$wait_seconds"
if [[ "$state_at_start" != "true "* || "$(container_state)" != "$state_at_start" ]]; then
  roll_back "the container of $target stopped or restarted within $wait_seconds s"
fi

if ! { docker image prune --force && docker builder prune --force; }; then
  echo "Warning: pruning failed; old images and build cache are still on disk."
fi
echo "Deployed $target."
