# One shared HTTPS proxy for the home server, not a Caddy per project

The NUC runs ChargeOnSolar and is meant to host more of the household's own
projects. [Security: authentication and remote access (#14)](https://github.com/roelnoort/ChargeOnSolar/issues/14)
put a Caddy container in ChargeOnSolar's own compose file. That breaks with
the second project: only one program can listen on port 443, and every
project would need its own certificate setup.

## Decision

- One Caddy stack, separate from every project, is the only stack on the
  NUC that publishes ports (80, 443). Projects publish none: they join the
  external Docker network `proxy`, and Caddy reaches them by container name.
- Caddy gets one wildcard certificate `*.<domain>` from Let's Encrypt by the
  DNS-01 challenge through TransIP, with the HTTP and TLS-ALPN challenges
  switched off: the NUC is never reachable from the internet. This needs a
  custom Caddy image with the TransIP DNS module.
- The Caddyfile has one site, `*.<domain>`, so every project shares the
  wildcard certificate. A project is one host matcher and handle block in
  it: `<name>.<domain>` to its container and port. ChargeOnSolar is
  `charge.<domain>`. Names without a block get no answer.
- The repo keeps the proxy as an example (`deploy/proxy`) that the NUC
  wizard copies into place. Deploying ChargeOnSolar never touches it.

## Considered options

- **A Caddy per project** (#14 as written): self-contained, but the second
  project cannot have port 443.
- **Traefik**: TransIP support is built in and projects announce themselves
  with labels, so the proxy needs no edit per project. Rejected: its config
  is harder to read and to troubleshoot, and a new project is rare.
- **Nginx Proxy Manager**: configured by clicking, so its settings live in
  its database instead of git.
- **TLS in each Node app, or Tailscale HTTPS certificates**: every project
  renews its own certificates and still competes for 443; Tailscale names
  only work with Tailscale on, which #14 rejected for use at home.

## Consequences

- Adding a project means editing the proxy's Caddyfile by hand on the NUC.
- The Caddy image is built from a pinned TransIP plugin commit; updating
  Caddy means bumping both pins.
- The TransIP API key lives only in the proxy stack, not in any project.
