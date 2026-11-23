# Caddy with the TransIP DNS provider, so it can get a wildcard certificate by
# the DNS challenge. The NUC is never reachable from the internet, so the HTTP
# and TLS-ALPN challenges cannot work there
# (docs/adr/0003-shared-proxy-for-the-home-server.md).
#
# The plugin is pinned by commit (its v2.0.3 tag): its go.mod has no /v2
# suffix, so Go cannot resolve the tag itself.

FROM caddy:2.11.9-builder AS builder
RUN xcaddy build \
  --with github.com/caddy-dns/transip@9b8f83754ff79a735a114dba4a4d38b7f54a7b76

FROM caddy:2.11.9
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
