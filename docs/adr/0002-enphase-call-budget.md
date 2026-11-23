# Enphase: one daily fetch, refreshes from what is left, and an encrypted refresh token

ChargeOnSolar shows Solar production from the Enphase Cloud API v4 on the free
Watt plan, which allows 1,000 calls a calendar month. Enphase is display-only:
its Solar production is a 5-minute average that arrives late, so it never goes
into Surplus.

## Decision

- **A daily fetch at 23:30 Europe/Amsterdam** stores the day's 5-minute
  production intervals. The sun has set by then even at midsummer, so the day
  is complete. Intervals are keyed on when they end and updated in place, so a
  later fetch that revises one (more microinverters reporting) replaces it.
- **Every call counts**, token renewals and failed calls included, because
  Enphase may count them too. The count is kept per Europe/Amsterdam calendar
  month. Enphase does not say in which time zone its month turns over; the
  guard below leaves enough slack that an hour's difference does not matter.
- **A refresh may only spend what the daily fetches do not need.** A fetch
  normally costs at most 2 calls (a token renewal and the telemetry call). A refresh
  is refused, with the numbers, unless the calls left after it still cover
  2 calls for every daily fetch left in the month, today's included. The
  daily fetch itself only needs 2 calls left. So a User can never press the
  button so often that the history stops being recorded.
- **The limit is a hard stop.** A fetch whose access token Enphase rejects
  early renews and asks again, so it can make up to 4 calls. Every call is
  therefore checked as it is counted, and once the month's 1,000 are used the
  call is refused rather than made, whatever fetch it belongs to.
- **The refresh token is encrypted at rest** with AES-256-GCM, a fresh IV for
  every write, and `enphase-refresh-token` as associated data. The key is
  `ENPHASE_TOKEN_KEY` in `.env`, never in the database. Enphase rotates the
  refresh token on every renewal, so it lives in app state rather than in
  `.env`, which the server does not write.
- **The first refresh token comes from a one-time CLI login**,
  `pnpm enphase login`, which trades the authorization code from Enphase's
  redirect address for tokens.

## Consequences

- At most about 60 calls a month go to the daily fetch; the rest, roughly
  900, are for refreshes, used up front or spread out as the household likes.
- Near the end of a busy month, refreshing is refused until the next month,
  while the daily history keeps being recorded.
- Losing or changing `ENPHASE_TOKEN_KEY` makes the stored token unreadable;
  `pnpm enphase login` once more fixes it.
- If the server is off for longer than the refresh token lives (about a
  month), the login has to be done again.
