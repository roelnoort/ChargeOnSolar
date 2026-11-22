# Sessions by emailed Login code: a cookie for the web, a Bearer token for native

Only known Users may use ChargeOnSolar, and there is no password to forget: a
User asks for a 6-digit Login code by email and trades it for a session.

## Decision

- A session is an opaque random token (32 bytes). The server stores only its
  SHA-256 hash, with the User, a device name, and when it was created and last
  used. It ends 90 days after its last use; every authenticated request counts
  as a use.
- The web app keeps the token in a `__Host-session` cookie: `HttpOnly`,
  `Secure`, `SameSite=Strict`, so no script in the page can read it. A native
  client (the future iPhone app) logs in with `client: "native"`, gets the
  token in the response body, and sends it as `Authorization: Bearer`.
- Every state-changing request must carry `x-chargeonsolar-csrf: 1`. A
  cross-site form cannot set a custom header, so this backs up `SameSite`
  against forged requests in browsers that do not honour it.
- One middleware guards all of `/api/`, with an allowlist of the two login
  routes. A route added later is protected without anyone remembering to.
- Asking for a code for an unknown address answers exactly as for a known
  one, and the email is sent without awaiting SMTP, so neither the answer
  nor its timing tells who has an account. The rate limit (5 requests per
  address per hour) counts unknown addresses too, for the same reason.
- A code works once, for 10 minutes, and is retired after 5 wrong attempts or
  when a newer code is sent.

## Consequences

- No CSRF token to fetch and keep in sync: the header is a constant.
- Without awaiting the mailer, an SMTP failure does not reach the User; it is
  logged, and the User asks for another code.
- Touching `last_used_at` on every request is one SQLite write per request,
  which is fine for one household.
