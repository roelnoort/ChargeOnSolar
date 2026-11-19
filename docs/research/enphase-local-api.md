# Enphase IQ Gateway: local API access (and cloud fallback)

Research for issue #4. Question: how do we read solar production (and house consumption, if metered) from an Enphase system, preferably locally from the IQ Gateway (Envoy)?

Researched 2026-11-19.

## Sources

| Key | Source | Trust |
|---|---|---|
| **[TB]** | Enphase Technical Brief *"Accessing IQ Gateway local APIs and local UI using token"*, TEB-00060-2.0-EN, June 2025. <https://enphase.com/download/accessing-iq-gateway-local-apis-or-local-ui-token-based-authentication> | Primary (Enphase) |
| **[V4-QS]** | Enphase API v4 Quickstart. <https://developer-v4.enphase.com/docs/quickstart.html> | Primary |
| **[V4-PLANS]** | Enphase API v4 developer plans. <https://developer-v4.enphase.com/developer-plans> | Primary |
| **[V4-RN]** | Enphase API v4 release notes. <https://developer-v4.enphase.com/docs/release_notes> | Primary |
| **[V4-FAQ]** | Enphase API v4 FAQ. <https://developer-v4.enphase.com/docs/faq> | Primary |
| **[V2]** | Legacy Enlighten Systems API docs (v2). <https://developer.enphase.com/docs> | Primary, but legacy |

The full v4 endpoint reference (`/docs/monitoring_api`) renders client-side and could not be read by the fetch tool. Endpoint-level details below come from the release notes and FAQ instead.

---

## 1. Firmware and when a token is needed

- From IQ Gateway software **7.0.x** onward, both the local UI and the local APIs require **cryptographic token-based authentication**. Before that they used password-based auth. [TB §1]
- **Legacy gateways that have an LCD** do not need a token for the local UI or the APIs. [TB §4.1 step 2]
- The SKUs covered include EU 230 V models (`ENV-S-WM-230`, `ENV-S-EM-230`, `ENV-S-WB-230`, `ENV-S-AM1-230-60`) as well as North American ones. However, the brief's cover page says *"Applicable regions: North America"*. [TB p.1, §1]
- `GET /info` is the one endpoint that **needs no token**. It returns the serial number, part number and firmware version (`<software>D7.4.22</software>`), and the `<web-tokens>true</web-tokens>` flag. [TB §4.2 table, App. A]
  - Our inference, not stated by Enphase: we can call `/info` at startup to detect the firmware and decide whether to send a token.

## 2. The token: obtaining, lifetime, renewal

**Lifetime** [TB §3.1 note, §4.2]:
- **System owner** account: the token is valid for **1 year**.
- **Installer** account: the token is valid for **12 hours**.
- A self-installer whose account has both roles gets a **12-hour** token from the web UI. To fix that, either ask Enphase Support to switch the account to owner credentials, or use the programmatic route.
- *"you must generate a new token upon expiry."* [TB §4.2] Enphase describes no refresh-token mechanism for the gateway token.

**How to obtain one** (you need the gateway serial number from the Enphase App under System > Devices > Gateway, labelled `SN:`) [TB §2]:

1. **Web UI** (one-off): log in at `https://entrez.enphaseenergy.com`, pick the system and gateway, and click *Create access token*. The token is shown **only once**. [TB §3.1]
2. **Browser GET**: open `https://enlighten.enphaseenergy.com/entrez-auth-token?serial_num=<serial>` while logged in. The response is JSON with `generation_time`, `token` and `expires_at` (Unix epoch). [TB §3.2]
3. **Programmatic, two calls** (this is what an unattended service would use) [TB §3.3, §3.4]:
   ```
   POST https://enlighten.enphaseenergy.com/login/login.json
        form: user[email]=<owner email>, user[password]=<password>
        -> JSON { session_id, ... }
   POST https://entrez.enphaseenergy.com/tokens
        JSON: { "session_id": ..., "serial_num": <gateway serial>, "username": <email> }
        -> response body is the raw token
   ```
   The brief's examples use `http://`. We should use `https://`.

**Implications for ChargeOnSolar** (our inference):
- Renewal needs internet access and Enphase cloud credentials once a year. Either store owner credentials and auto-renew before `expires_at`, or have the user paste a new token yearly and show a warning when expiry is near.
- The token is a JWT (sample starts `eyJraWQi…`) [TB §3.2 screenshot], so we can decode its expiry locally.

## 3. Calling the local API

[TB §4.2]
- Use HTTPS to the gateway's LAN IP, or `https://envoy.local/` (additional gateways are `envoy-2.local`, `envoy-3.local`). [TB §4.1]
- Send the headers `Authorization: Bearer <token>` and `Accept: application/json`.
- **Self-signed certificate**: *"IQ Gateway uses a self-signed certificate"* [TB §4.1 step 3]. Enphase's own curl example uses `-k` (*"allow self-signed certificate"*). In Node this means a custom `https.Agent`/undici dispatcher with `rejectUnauthorized: false`, scoped to the gateway host only. Pinning the gateway's certificate fingerprint on first contact would be stricter. That is our suggestion; Enphase does not publish a CA.
- Enphase recommends `-f` (fail on error) because an unauthenticated request gets a **redirect** to the login page rather than a clean 401. [TB §4.2]

### Relevant endpoints

| Endpoint | What it gives | Update rate stated by Enphase | Needs CTs? |
|---|---|---|---|
| `GET /info` | Serial, firmware, `web-tokens` flag. **No token needed.** | n/a | No |
| `GET /ivp/meters` | List of meters (`eid`, `state` enabled/disabled, `measurementType` = `production` / `net-consumption` / `total-consumption`, `phaseCount`, `meteringStatus`) | n/a | Lists what is installed |
| `GET /ivp/meters/readings` | Per-meter cumulative energy (`actEnergyDlvd`/`Rcvd`) and instantaneous `activePower` (W), V, A, Hz, with per-phase `channels` | **"once every five minutes"** | Yes, production, storage and consumption CTs, *"subject to the availability of CTs"* |
| `GET /ivp/meters/reports/consumption` | Load power `currW`/`actPower` (W), cumulative Wh, per-phase `lines`; `reportType` is `net-consumption` or `total-consumption` | **"once every five minutes"** | Yes, consumption CT |
| `GET /ivp/meters/gridReading` | Per-phase active and reactive power, V, A, Hz at the grid connection. **Negative = export (feed-in), positive = import.** | not stated | Yes, implicitly a grid-side CT |
| `GET /ivp/livedata/status` | `meters.pv`, `.grid`, `.load`, `.storage`, `.generator` with `agg_p_mw` (**milliwatts**) and per-phase values; `last_update` epoch | not stated (it is the "live" feed) | pv/grid/load need meters |
| `GET /api/v1/production` | `wattsNow`, `wattHoursToday`/`SevenDays`/`Lifetime` | not stated | **Contradictory**, see note |
| `GET /ivp/pdm/energy` | `production.pcu` (microinverters), `production.eim` (production CT), `consumption.eim` (consumption CT): `wattsNow` and Wh totals | not stated | Works without a production meter |
| `GET /api/v1/production/inverters` | Per-microinverter `lastReportWatts`, `lastReportDate` | **"once every five minutes"** | No |
| `GET /ivp/ensemble/device_list` | Commissioning and status of batteries and other devices | n/a | No |

Sources: [TB §4.2 table, Appendices A–J].

**Note on `/api/v1/production`.** The brief contradicts itself. The table in §4.2 says it *"works even when the production meter is not installed"*. Appendix E says it *"will work only when the production meter is installed and enabled"*. For a meter-less site, use `/ivp/pdm/energy` → `production.pcu.wattsNow`. Both the table and Appendix F say that endpoint works without a meter.

**Note on update frequency.** Enphase states a **5-minute** refresh for `/ivp/meters/readings`, `/ivp/meters/reports/consumption` and `/api/v1/production/inverters`. It gives no refresh rate for `/ivp/livedata/status` or `/ivp/meters/gridReading`, and no polling limit for the local API in general. Faster updates should be checked against a real gateway before we depend on them. Two things are still unverified:
- Whether `/ivp/livedata/status` only streams after it is enabled with a write call. Its `connection.sc_stream` field hints at this.
- What the actual refresh rate of the meter endpoints is.

## 4. Are consumption CTs needed for house consumption?

**Yes**, when the data comes from Enphase.
- Microinverter data (`pcu`, `/api/v1/production/inverters`) only covers **production**. [TB App. F, G]
- House load and grid import and export come from **consumption CTs**. The meter endpoints return them *"subject to the availability of CTs"*. [TB §4.2, App. D]
- `/ivp/meters` tells us which CTs are present and enabled, and in which mode. [TB App. C]

The consumption CT can be installed in one of two modes [TB App. I note]:
- **`net-consumption`**: *"reporting of the load along with solar production"*. The CT sits at the grid connection, so its reading is the **grid import/export**, which is what solar-surplus logic needs. House load = production + net.
- **`total-consumption`**: *"reporting of the load only, excluding solar production."* Grid flow = load − production.

Without consumption CTs, Enphase can only give us **production**. Surplus would then need another source, such as a P1 smart-meter port, which is outside the scope of this note.

## 5. Cloud fallback: Enphase API v4

**Auth** [V4-QS]:
- OAuth 2.0. Every request carries `Authorization: Bearer <access_token>` and the application's **API key**.
- The system owner approves the app once via an authorization URL. The code is then exchanged at `/oauth/token` using Basic auth with the client id and secret.
- **The access token is valid for 1 day and the refresh token for 1 month.** Refresh with `grant_type=refresh_token`, which also returns a new refresh token.

**Plans and rate limits** [V4-PLANS]:

| Plan | Price | Hits/min | Hits/month | Includes |
|---|---|---|---|---|
| **Watt** | Free | **10** | **1,000** | System details, site-level production, site-level consumption, EV charger monitoring |
| Kilowatt | USD 249/mo + $0.10 per Live Status hit | 50 | 50,000 | + device-level monitoring, Streaming API |
| Megawatt | USD 999/mo + $0.10 per Live Status hit | 100 | 300,000 | + system configuration |

- On the free plan, **1,000 hits a month is about 33 a day, so roughly one call every 45 minutes.** The cloud is only usable as a coarse fallback or for daily backfill, never as a live control signal.
- On the legacy v2 API, going over the limit returns `409 Conflict`. The JSON body carries `period`, `period_start` and `period_end`, and you may retry after `period_end`. Too many concurrent requests return `503`. [V2] The v4 docs we could read do not state v4 throttling behavior.

**Useful v4 endpoints**:
- `GET /api/v4/systems/{system_id}/latest_telemetry` returns the *"last reported PV Power, Consumption Power, and Battery Power in Watts"* (added 2024-01-15). Values are null if the last report is more than 7 days old. [V4-RN]
- `GET /api/v4/systems/{system_id}/telemetry/production_micro` gives **5-minute** intervals. [V4-FAQ]
- `.../telemetry/production_meter` and `.../telemetry/consumption_meter` give **15-minute** intervals. Sites configured for it can request 5-minute intervals with `interval_duration`. [V4-FAQ, V4-RN 2022-08-12]
- Telemetry requests may span **at most 7 days**, and the start must be **within 2 years**. [V4-FAQ, V4-RN 2022-02-23]
- **Live Status** streams real-time data for 30–300 s. It needs IQ Gateway firmware ≥ 6.0.0 and is billed per hit on the paid plans. [V4-RN 2023-06-20, V4-PLANS]
- **Cloud latency**: the legacy docs say a meter reading is *"Commonly … within 30 minutes of the requested end_at."* [V2]

## 6. Recommendation (our synthesis)

1. **Primary source is local.** Poll the gateway over HTTPS on the LAN, using an owner token, with TLS verification disabled or the certificate pinned for that host only.
   - With CTs, read `/ivp/meters/readings`, or `/ivp/livedata/status` once it is confirmed live.
   - Without CTs, read `/ivp/pdm/energy` for production.
   - Detect firmware and token need with `/info` and the CT setup with `/ivp/meters` at startup.
2. **Token lifecycle.**
   - Store the token together with its `expires_at` / JWT `exp`.
   - Either store owner credentials and renew automatically via `login.json` → `entrez.enphaseenergy.com/tokens` some weeks before expiry, or warn the user to paste a new token.
   - Treat a redirect or 401 from the gateway as "token invalid".
3. **Cloud is not a live fallback.** The free plan allows 10/min and 1,000/month, and cloud data lags up to about 30 minutes. Use it only for gaps or backfill, if at all.

## Open questions (need a real gateway)

- What is the actual refresh rate of `/ivp/meters/readings` and `/ivp/livedata/status`? Does live data need to be enabled first?
- Which firmware does the user's gateway run, and is it a metered model with consumption CTs? In which mode (net or total)?
- Does the brief's "North America" scope matter for EU firmware? The EU SKUs are listed, so probably not.
- Is there a local request-rate limit? Enphase states none.
