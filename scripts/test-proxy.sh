#!/usr/bin/env bash
#
# Checks the shared proxy example in deploy/proxy: builds the custom Caddy
# image, checks it carries the TransIP DNS module, validates the Caddyfile with
# placeholder settings, and checks what the config asks Caddy to do: a wildcard
# certificate via the TransIP DNS challenge only, and charge.<domain> sent to
# the ChargeOnSolar container. CI runs this on every pull request; run it
# locally with `pnpm test:proxy` (needs Docker and jq).

set -euo pipefail

cd "$(git rev-parse --show-toplevel)/deploy/proxy"

image="home-proxy:test"
domain="example.test"
key_dir=$(mktemp -d)
network="proxy-test-$$"
container=""

cleanup() {
  if [[ -n "$container" ]]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$key_dir"
}
trap cleanup EXIT

fail() {
  echo "✖ $1" >&2
  exit 1
}

echo "▸ Building $image"
docker build --tag "$image" .

echo "▸ The image has the TransIP DNS module"
docker run --rm "$image" caddy list-modules | grep -qx 'dns.providers.transip' ||
  fail "dns.providers.transip is not in the image"

# A placeholder key: validation must not need the real TransIP credentials.
printf 'placeholder\n' >"$key_dir/transip.key"
settings=(
  --env DOMAIN="$domain"
  --env ACME_EMAIL="admin@$domain"
  --env TRANSIP_LOGIN="placeholder"
  --volume "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro"
  --volume "$key_dir/transip.key:/etc/caddy/transip.key:ro"
)
caddy_in_image() {
  docker run --rm "${settings[@]}" "$image" caddy "$@"
}

echo "▸ caddy validate accepts the Caddyfile"
caddy_in_image validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null ||
  fail "caddy validate rejected the Caddyfile"

config=$(caddy_in_image adapt --config /etc/caddy/Caddyfile --adapter caddyfile 2>/dev/null)

echo "▸ One wildcard certificate, from the TransIP DNS challenge only"
policies=$(jq -c '.apps.tls.automation.policies' <<<"$config")
jq -e --arg wildcard "*.$domain" \
  'any(.[]; (.subjects // []) | index($wildcard))' <<<"$policies" >/dev/null ||
  fail "no certificate policy for *.$domain"
jq -e 'all(.[]; all(.issuers[]?; .challenges.dns.provider.name == "transip"))' <<<"$policies" >/dev/null ||
  fail "an issuer does not use the TransIP DNS challenge"
jq -e 'all(.[]; all(.issuers[]?; (.challenges.http.disabled == true) and (.challenges["tls-alpn"].disabled == true)))' <<<"$policies" >/dev/null ||
  fail "the HTTP or TLS-ALPN challenge is not disabled (the NUC is not reachable from the internet)"

echo "▸ charge.$domain goes to the ChargeOnSolar container"
jq -e --arg host "charge.$domain" '
  [.. | objects | select(.match? and any(.match[]; (.host // []) | index($host))) | .. | objects | .upstreams? // empty | .[].dial]
  | index("chargeonsolar:3000")' <<<"$config" >/dev/null ||
  fail "charge.$domain is not proxied to chargeonsolar:3000"

# Caddy adds the port-80 redirect when it starts, so run it. The network is
# internal: no route to Let's Encrypt or TransIP with the placeholder settings.
echo "▸ Plain HTTP redirects to HTTPS"
docker network create --internal "$network" >/dev/null
container=$(docker run --detach --network "$network" --network-alias proxy "${settings[@]}" "$image")
location=""
for _ in $(seq 1 10); do
  location=$(docker run --rm --network "$network" curlimages/curl:8.17.0 \
    --silent --output /dev/null --write-out '%{http_code} %{redirect_url}' \
    --header "Host: charge.$domain" http://proxy/now 2>/dev/null || true)
  [[ "$location" == 3* ]] && break
  sleep 1
done
[[ "$location" == "308 https://charge.$domain/now" ]] ||
  fail "http://charge.$domain/now answered '$location', expected a 308 to https://charge.$domain/now"

echo "✔ Proxy config checks passed"
