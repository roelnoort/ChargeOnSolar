#!/usr/bin/env bash
#
# Smoke-tests the ChargeOnSolar container image from the outside: builds it,
# starts it with no device settings and a temporary data folder, and checks
# that it serves the web app and the API, writes its database to the data
# folder, and keeps running. CI runs this on every pull request; run it locally
# with `pnpm test:image` (needs Docker).

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

image="chargeonsolar:smoke-test"
port=3999
base_url="http://127.0.0.1:$port"
data_dir=$(mktemp -d)
container=""

cleanup() {
  if [[ -n "$container" ]]; then
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
  # Files the container wrote may belong to its user; remove them from inside.
  docker run --rm -v "$data_dir:/data" --entrypoint sh "$image" -c 'rm -rf /data/*' >/dev/null 2>&1 || true
  rm -rf "$data_dir"
}
trap cleanup EXIT

fail() {
  echo "✖ $1" >&2
  if [[ -n "$container" ]]; then
    echo "--- container log ---" >&2
    docker logs "$container" >&2 || true
  fi
  exit 1
}

echo "▸ Building $image"
docker build --tag "$image" .

# The container runs as the image's unprivileged user; let it write here the
# way the NUC's data folder is owned by the deploying user.
chmod 777 "$data_dir"

echo "▸ Starting the container with no device settings"
container=$(docker run --detach --publish "127.0.0.1:$port:3000" --volume "$data_dir:/data" "$image")

startup_timeout_seconds=30
for _ in $(seq 1 "$startup_timeout_seconds"); do
  if curl --silent --output /dev/null "$base_url/"; then break; fi
  sleep 1
done

echo "▸ / serves the web app"
page=$(curl --silent --fail "$base_url/") || fail "/ did not answer with 2xx"
grep -q '<div id="root">' <<<"$page" || fail "/ did not return the web app's index.html"

echo "▸ The API answers"
status=$(curl --silent --output /dev/null --write-out '%{http_code}' "$base_url/api/live")
[[ "$status" == "200" || "$status" == "401" ]] || fail "/api/live answered $status, expected 200 or 401"

echo "▸ The database is in the mounted data folder"
compgen -G "$data_dir/*.db" >/dev/null || fail "no database file in the data folder"

echo "▸ The container keeps running"
sleep 5
[[ "$(docker inspect --format '{{.State.Running}}' "$container")" == "true" ]] || fail "the container stopped"
[[ "$(docker inspect --format '{{.RestartCount}}' "$container")" == "0" ]] || fail "the container restarted"

echo "✔ Image smoke test passed"
