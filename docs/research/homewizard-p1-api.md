# HomeWizard P1 meter local API (v1 vs v2)

Research for issue #5. Researched 2026-11-19 against HomeWizard's official API documentation at <https://api-documentation.homewizard.com>. Every claim cites the page it came from. Where the docs say nothing, this file says so.

## TL;DR

- The P1 meter (`HWE-P1`) supports **both v1 and v2** of the local API. v1 is **deprecated**: no new features, only critical bug fixes, and it "will be removed in the future". Build on **v2**.
- **v2**: HTTPS on port 443, a Bearer token obtained once by **pressing the button on the device**, the `X-Api-Version: 2` header, and a **WebSocket** at `wss://<ip>/api/ws` that pushes measurement updates.
- **v1**: plain HTTP with no auth at `http://<ip>/api/v1/data`. It must be switched on in the HomeWizard app ("Local API").
- **Values**: net power (W, negative when exporting), per-phase power, current and voltage, plus cumulative import and export kWh in total and per tariff. Gas and other external meters are also available.
- **Update rate** depends on the smart meter: **DSMR 5.0 gives 1 s for power** (gas every 5 min). **Older meters give 10 s** (gas every 60 min).
- **Polling limits**: none enforced. HomeWizard advises **no more often than every 500 ms**. **Connection limits are not documented.**

## API versions

| | v1 | v2 |
|---|---|---|
| Transport | HTTP, port 80 | HTTPS, port 443 |
| Base path | `/api/v1/...` (device info at `/api`) | `/api/...` |
| Auth | None. The API must be enabled in the app | `Authorization: Bearer <token>` |
| Enable step | App: Settings → Meters → *your meter* → turn on *Local API* | Always on. A token must be paired once |
| Push | None (poll only) | WebSocket `wss://<ip>/api/ws` |
| mDNS service | `_hwenergy._tcp` | `_homewizard._tcp` |
| Status | Deprecated | Current |

Sources: [Introduction](https://api-documentation.homewizard.com/docs/introduction), [Getting started](https://api-documentation.homewizard.com/docs/getting-started), [Discovery](https://api-documentation.homewizard.com/docs/discovery), [Versioning](https://api-documentation.homewizard.com/docs/versioning), [Changelog](https://api-documentation.homewizard.com/docs/changelog).

- The Introduction support table lists the P1 meter as "Supported" for v1 and "Supported 2.3.0" for v2. The docs don't label what "2.3.0" refers to. The v2 device-info example response shows `"firmware_version": "6.00"` for a P1 meter ([v2 Device information](https://api-documentation.homewizard.com/docs/v2/device_information)). Third-party summaries say v2 requires P1 firmware 6.00. That is plausible but **unverified** against an official statement.
- Changelog: "v1 … Feature development has stopped … only critical bug fixes … will be removed in the future", and the docs recommend upgrading to v2. v2 2.0.0 was released 21-01-2025. The latest listed version is 2.3.0 (09-04-2026); its changes concern batteries, not P1 measurement.
- Versioning: on HTTPS, "If no version is specified, the latest version is used by default". Sending `X-Api-Version: 2` pins the major version. "Only Version 1 is supported over HTTP." Requesting v1 over HTTPS returns 400 `request:api-version-not-supported`.
- v1 can be switched off from v2 with `PUT /api/system {"api_v1_enabled": false}`. After that, only authorized v2 requests are accepted ([v2 System](https://api-documentation.homewizard.com/docs/v2/system)).

## v2 authentication (token pairing)

Source: [v2 Authorization](https://api-documentation.homewizard.com/docs/v2/authorization).

1. Send `POST https://<ip>/api/user` with the headers `Content-Type: application/json` and `X-Api-Version: 2`, and the body `{"name": "local/<name>"}`. The name must match `^local\/[a-zA-Z0-9\-_/\\# ]{1,40}$`.
2. Until someone presses the button on the device, the response is `403` `user:creation-not-enabled`. Keep retrying the request. "Once the button is pressed, you have a window of 30 seconds to request the token."
3. The next request returns `200` with `{"token": "...", "name": "local/<name>"}`. The token matches `^[A-F0-9]{32}$` and "grants full access to the device's data".
4. Every later request sends `Authorization: Bearer <token>` and `X-Api-Version: 2`. A missing or invalid token returns `401` `user:unauthorized`.

- Reusing a name issues a new token and **invalidates the previous one**.
- `GET /api/user` lists users. `DELETE /api/user {"name": ...}` revokes a user.
- The docs don't state a maximum number of users, but the error `user:no-storage` ("No storage is available for a new user") implies a cap ([v2 Error handling](https://api-documentation.homewizard.com/docs/v2/error-handling)).

### HTTPS certificate

- The device presents a certificate signed by the **HomeWizard CA**, which is downloadable as PEM from the Authorization page. HomeWizard recommends validating the certificate against that CA.
- The expected hostname is not the IP address. It is `appliance/p1dongle/<serial>`, which is the same value as the `id` TXT record in mDNS ([Discovery](https://api-documentation.homewizard.com/docs/discovery)). Node or TS clients need a custom `servername` or `checkServerIdentity`. The docs' own curl examples use `--insecure`.

## Values available (P1 meter)

### v2: `GET /api/measurement`

Source: [v2 Recent measurement](https://api-documentation.homewizard.com/docs/v2/measurement).

| Field | Unit | Notes |
|---|---|---|
| `power_w` | W | Total, the sum of the phases. **Net**: negative when exporting (inferred from the per-phase rule) |
| `power_l1_w`, `power_l2_w`, `power_l3_w` | W | Per phase, "negative when exporting" |
| `voltage_v`, `voltage_l1_v`..`voltage_l3_v` | V | |
| `current_a` | A | "sum of absolute values", so unsigned |
| `current_l1_a`..`current_l3_a` | A | Per phase, negative when exporting |
| `energy_import_kwh`, `energy_import_t1_kwh`..`t4_kwh` | kWh | Cumulative import, total and per tariff |
| `energy_export_kwh`, `energy_export_t1_kwh`..`t4_kwh` | kWh | Cumulative export, total and per tariff |
| `tariff` | – | Active tariff |
| `frequency_hz` | Hz | |
| `average_power_15m_w`, `monthly_power_peak_w`, `monthly_power_peak_timestamp` | W | Belgian capacity tariff |
| `voltage_sag_l*_count`, `voltage_swell_l*_count`, `any_power_fail_count`, `long_power_fail_count` | count | Power quality |
| `timestamp` | ISO 8601 | **No timezone** |
| `protocol_version`, `meter_model`, `unique_id` | – | `protocol_version` is the DSMR version |
| `external[]` | varies | Gas and other meters (`type`, `value`, `unit`, `timestamp`) |

"All data points are optional". Fields can be missing, for example L2 and L3 on a single-phase connection, so a client must handle absent keys.

`GET /api/telegram` returns the raw DSMR telegram as `text/plain`. It returns `503` `telegram:no-telegram-received` when the meter hasn't sent one ([v2 Telegram](https://api-documentation.homewizard.com/docs/v2/telegram)).

### v1: `GET /api/v1/data`

Source: [v1 Recent measurement](https://api-documentation.homewizard.com/docs/v1/measurement). These are the same quantities under different names:

- `active_power_w` and `active_power_l1_w`..`l3_w`. The examples show negative values while exporting.
- `active_voltage_l1_v`..`l3_v`, `active_current_l1_a`..`l3_a`, `active_frequency_hz`.
- `total_power_import_kwh` and `total_power_import_t1_kwh`..`t4_kwh`, plus `total_power_export_kwh` and `..._t1_kwh`..`t4_kwh`.
- `total_gas_m3`, `active_power_average_w`, `montly_power_peak_w` (misspelled as in the API), and the sag, swell and fail counters.
- "The API does not send data points that are `null` or not available at all."

## Update frequency

Source: [Getting started](https://api-documentation.homewizard.com/docs/getting-started).

- How often the P1 meter updates depends on the smart meter's DSMR version. A **DSMR 5.0** meter sends "every second for power and every 5 minutes for gas". A meter **older than DSMR 5.0** sends power every 10 seconds and gas every 60 minutes.
- The v2 WebSocket pushes updates "when data changes" ([v2 WebSocket](https://api-documentation.homewizard.com/docs/v2/websocket)). For a P1 meter on DSMR 5 that should be about one push per second, but the docs don't state a push interval explicitly.

## v2 WebSocket

Source: [v2 WebSocket](https://api-documentation.homewizard.com/docs/v2/websocket).

- The endpoint is `wss://<ip>/api/ws` and uses the same certificate as HTTPS.
- On connect, the device sends `{"type":"authorization_requested","data":{"api_version":"2.0.0"}}`. The client replies `{"type":"authorization","data":"<TOKEN>"}` and receives `{"type":"authorized"}`. "you must send the authorization token within 40 seconds, or the connection will close."
- To subscribe, send `{"type":"subscribe","data":"measurement"}`. The other topics are `device`, `system`, `user`, `batteries` and `*`. The device sends the latest values straight away, then each update after that. `unsubscribe` exists. Sending `{"type":"measurement"}` polls once.
- Every message is JSON with `type` and an optional `data`. Errors come as `{"type":"error","data":{"message":"..."}}`.
- **Keepalive and ping/pong are not documented.**

## Limits on polling and connections

- Polling: "There is no limit to the time between each request on the local API", but "we advise not to retrieve data more often than every 500ms" ([Getting started](https://api-documentation.homewizard.com/docs/getting-started)). Since power only updates every 1 s at best, polling faster than 1 Hz gains nothing.
- Rate limiting: the error-handling page lists no 429 or rate-limit error ([v2 Error handling](https://api-documentation.homewizard.com/docs/v2/error-handling)).
- **Concurrent connections: not documented anywhere in the official docs.** Community reports (low trust, e.g. on the Home Assistant forum) say the device accepts only a small number of active connections, and that connections not closed properly can block the API until a reboot or until the local API is toggled. `PUT /api/system/reboot` exists in v2 ([v2 System](https://api-documentation.homewizard.com/docs/v2/system)). The safe design is **one long-lived connection per meter**, owned by one process, that is closed cleanly and reconnects with backoff.

## Discovery

Source: [Discovery](https://api-documentation.homewizard.com/docs/discovery).

- v2 devices advertise `_homewizard._tcp` (port 443) with the TXT records `api_version`, `id` (`appliance/<product_type>/<serial>`, used for certificate validation), `serial`, `product_type` and `product_name`.
- v1 devices advertise `_hwenergy._tcp` (port 80) with the TXT records `api_enabled` (0 or 1), `path=/api/v1`, `serial`, `product_type` and `product_name`.

## Open questions (not answered by official docs)

- The maximum number of concurrent HTTP and WebSocket clients, and the maximum number of paired tokens.
- The WebSocket push cadence and whether a keepalive is needed.
- Exactly which firmware version first enabled v2 on the P1 meter. 6.00 is likely but not confirmed.
- The sign of `power_w` is inferred from the per-phase "negative when exporting" rule, not stated directly. Check it on a real meter during export.
