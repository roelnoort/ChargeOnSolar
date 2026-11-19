# Porsche Macan Electric connected-car API

Research for issue #17. Question: what can ChargeOnSolar read from a Porsche Macan Electric through a connected-car API, and can a self-hosted TypeScript backend use it? Can the car complement or replace the Zaptec cloud as the source of Charger power, and so of Surplus?

Researched 2026-11-19. Sources fall into two trust levels:

- **Official (high trust):** Porsche's own pages. These are the developer portal FAQ and terms, the Porsche Connect Store, and the EU Data Act pages.
- **Unofficial (lower trust, marked "(unofficial)"):** the source code of the most established open-source clients for the My Porsche app backend. These are [`CJNE/pyporscheconnectapi`][pyp] (Python, MIT, the reference implementation), its Home Assistant integration [`CJNE/ha-porscheconnect`][ha], and evcc's Go port in [`evcc-io/evcc` `vehicle/porsche`][evcc-src]. They were read at HEAD on 2026-11-19 (pyp `dd13985`, evcc `073384c`). Porsche does not document the backend they use, and it can change without notice.

Anything marked **(inferred)** is our own reading of the sources.

## TL;DR

| Question | Answer | Source |
|---|---|---|
| Official public API for owners or hobbyists? | **No.** "We do not offer any public APIs." The developer portal is for Porsche partner companies only, for services offered by Porsche AG or its subsidiaries. | [Developer FAQ][dev-faq], [Developer terms][dev-terms] |
| Official third-party route? | EU Data Act: the **Porsche Data Hub** (data.porsche.com). Owners download their data or grant access to third parties. Commercial aggregators such as High Mobility also exist (B2B, reviewed, paid). No self-serve real-time API for individuals was found. | [Porsche NL EU Data Act][nl-dataact], [High Mobility Porsche guide][hm] |
| Unofficial route? | The My Porsche app backend `https://api.ppa.porsche.com/app`, using an Auth0 login that impersonates the official app. Used by pyporscheconnectapi, ha-porscheconnect and evcc. | (unofficial) [evcc const.go][evcc-const], [pyp const.py][pyp-const] |
| Macan Electric supported? | Yes, by the unofficial clients ("Macan (EV, from 2024)") and by High Mobility ("Macan EV (2nd gen)"). Needs an active Porsche Connect subscription; in NL that is **10 years included** for Macan MY2024. | (unofficial) [pyp README][pyp], [HM][hm], [Connect Store NL][store-nl] |
| Charging power available? | Yes, `CHARGING_RATE.chargingPower`, in **kW** | (unofficial) [ha sensor.py][ha-sensor], [evcc types.go][evcc-types] |
| Charging state / plugged-in? | `CHARGING_SUMMARY.status`: `CHARGING`, `CHARGING_COMPLETED`, `NOT_CHARGING`, `NOT_PLUGGED`. There is **no separate plugged flag**: you derive it from the status. | (unofficial) [evcc provider.go][evcc-provider] |
| State of charge / target SoC? | `BATTERY_LEVEL.percent`; `CHARGING_SUMMARY.targetSoC` (newer vehicles), with fallbacks to `CHARGING_SETTINGS.targetSoc` and to charging profile `minSoC` | (unofficial) [evcc types.go][evcc-types], [pyp vehicle.py][pyp-vehicle] |
| Update cadence | Stored values only change when the car pushes them. A live read needs a `wakeUpJob`, which wakes the car. Default polling in the clients: **32 min** (HA) and **15 min** (evcc). | (unofficial) [ha const.py][ha-const], [evcc template][evcc-tpl] |
| Rate limits | None documented. `429 Too Many Requests` does happen in practice. | (unofficial) [pyp #63][pyp-63], [pyp exceptions.py][pyp-exc] |
| Auth stability | Poor. Captcha on every fresh login, PKCE, a passkey-enrolment interstitial, and repeated breaking changes (2023, June 2024, Nov 2026). | (unofficial) see [Authentication](#authentication-and-its-stability) |
| TypeScript client? | None maintained. npm `porsche-connect` was last published 2024-02-18, before the June 2024 API retirement. | `npm view porsche-connect`, [pyp #46][pyp-46] |

**(inferred) Verdict for "Which source determines Surplus":** the car is **not usable as the source of Charger power**. Its power value is minutes to tens of minutes stale unless you wake the car, polling hard risks `429`s and battery drain, and access is unofficial and breaks regularly. Keep Zaptec as the source of Charger power. The car can **complement** it with values the charger cannot know: state of charge, target SoC, and the car's own charging status. Those suit Shadow decisions such as "stop solar-only charging once SoC ≥ X" or "ignore Surplus when the car reports `CHARGING_COMPLETED`". Treat them as optional, best-effort inputs that may disappear.

## Official access

### Porsche developer portal: partners only

- The FAQ says: "We do not offer any public APIs; in addition, access to the portal enables access to the sensitive data that requires contractual protection." Only Porsche partner companies get access, "so that the APIs are only used for services offered by Porsche AG or its subsidiaries". You become a partner through the VW Group Supply Portal. [Developer FAQ][dev-faq]
- The portal terms (last revised 30 Sep 2020) say the portal is "for businesses only" and is not for consumers (§1.2). They forbid robots, spiders and scrapers (§4.2(b)) and reverse engineering (§4.2(e)). [Developer terms][dev-terms] **(inferred)** These terms govern the developer portal itself, not the My Porsche consumer account, so they do not directly bind someone who never signed up for the portal. They do show how Porsche regards automated and reverse-engineered access.

### EU Data Act: Porsche Data Hub

- Porsche's NL page says owners can request a copy of their historical vehicle data, pick specific data points to access or share, and allow external providers to access certain data. Consent is managed in the brand ID portal, and the portal is the Porsche AG Data Hub at data.porsche.com. [Porsche NL EU Data Act][nl-dataact]
- The page does not mention a data format, update frequency, real-time availability or an API. [Porsche NL EU Data Act][nl-dataact] **(inferred)** As published, this is a data-export and consent mechanism, not a live telemetry feed for a home system. Whether an individual can register as their own "third party" and receive near-real-time charging data is unknown (see open questions).

### Aggregator: High Mobility (official partner channel, B2B)

- Lists the Macan EV (2nd gen, from 2024) and requires activated Porsche Connect. Customers in 29 European countries, the Netherlands among them, can grant third-party access. [HM Porsche guide][hm]
- Freshness: data refreshes "at the start and end of each trip". EVs "can also send higher-frequency updates while driving and during charging". "Streaming" is "provided by HM through periodic polling". Privacy mode stops all data. [HM Porsche guide][hm]
- Pricing is per data point, shown only after you register a production application, and activation follows a review. [HM Porsche guide][hm] **(inferred)** This is aimed at businesses, and its freshness is no better than the unofficial route. It is not a good fit for a single household.

## Unofficial access (My Porsche app backend)

Everything in this section is **(unofficial)**: it comes from client source code that mimics the official My Porsche Android app (`de.porsche.one`).

### Endpoints

- API base `https://api.ppa.porsche.com/app`. Identity provider `https://identity.porsche.com` (Auth0), audience `https://api.porsche.com`. Headers: an app `User-Agent` (`de.porsche.one/21.26.46-row+195601 (android)`) and an `X-Client-ID`. [evcc const.go][evcc-const], [pyp const.py][pyp-const]
- `GET /connect/v1/vehicles` lists vehicles (VIN, model name, `modelType.engine` = BEV/PHEV/COMBUSTION). [evcc api.go][evcc-api], [evcc types.go][evcc-types]
- `GET /connect/v1/vehicles/{vin}?mf=BATTERY_LEVEL&mf=CHARGING_SUMMARY&...` returns the **stored overview**: an array of `{key, status: {isEnabled, cause}, value}` measurements. [evcc api.go][evcc-api], [evcc types.go][evcc-types]
- Adding `&wakeUpJob=<uuid>` returns a **current overview** that first wakes the car. [pyp vehicle.py][pyp-vehicle], [evcc api.go][evcc-api]
- This backend replaced the old one, which Porsche retired around June 2024. The maintainer wrote: "the APIs we used to rely on are retired. So the current version of this library is completely defunct." [pyp #46][pyp-46]

### Values relevant to ChargeOnSolar

| Measurement | Fields | Notes |
|---|---|---|
| `BATTERY_LEVEL` | `percent` | High-voltage state of charge [evcc types.go][evcc-types] |
| `CHARGING_RATE` | `chargingPower` (kW), `chargingRate` | HA exposes `chargingPower` as a power sensor in kW [ha sensor.py][ha-sensor]. pyp sets both to 0 when not charging, and derives km/h as `chargingRate * 60` [pyp vehicle.py][pyp-vehicle] |
| `CHARGING_SUMMARY` | `status`, `mode` (e.g. `DIRECT`, `PROFILE`), `type` (`AC`/`DC`), `targetSoC`, `targetDateTimeWithOffset` | Observed statuses: `CHARGING`, `CHARGING_COMPLETED`, `NOT_CHARGING`, `NOT_PLUGGED`. "The PPA API has no explicit 'plugged' flag" [evcc provider.go][evcc-provider] |
| `CHARGING_SETTINGS`, `CHARGING_PROFILES`, `DIRECT_CHARGING`, `CHARGING_SESSION`, `DEPARTURES`, `TIMERS` | various | Fallback target SoC and charging schedules [pyp const.py][pyp-const], [pyp vehicle.py][pyp-vehicle] |
| `E_RANGE`, `MILEAGE`, `GPS_LOCATION`, `HVAC_SUMMARY`, `GLOBAL_PRIVACY_MODE` | | `GPS_LOCATION` could tell "car at home" [evcc provider.go][evcc-provider] |

Remote commands such as starting and stopping direct charging exist too (scope `manageCharging`, pyp `remote_services.py`). They are out of scope for v1 monitoring. [pyp const.py][pyp-const]

**(inferred)** The car's `chargingPower` is what the car reports, not the Zaptec meter. It may differ from Charger power, for example by on-board charger losses, and it has its own rounding. It works as a cross-check, not as a drop-in replacement in the Surplus formula.

### Update frequency, latency and rate limits

- The stored overview only shows what the car last uploaded. A parked, sleeping car "may legitimately stop reporting". [ha-porscheconnect README][ha]
- The HA integration polls every **1920 s (32 min)** by default and offers a manual "Get current vehicle information" button for a wake-up read. [ha const.py][ha-const], [ha button.py][ha]
- evcc caches for **15 min** by default and wakes the car only through its `Resurrector` hook. [evcc template][evcc-tpl], [evcc provider.go][evcc-provider]
- No rate limit is published. Users hit `429 Too Many Requests`, after which "all sensors turn to Unavailable". The maintainer replied: "This is the behaviour of the API unfortunately." pyp now retries 429/502/503/504. [pyp #63][pyp-63], [pyp connection.py][pyp]
- pyp's error mapping includes `405 MOBILE_ACCESS_DISABLED`, `408 VEHICLE_UNAVAILABLE` and `423 ACCOUNT_LOCKED`. [pyp exceptions.py][pyp-exc]
- **(inferred)** Real-time Surplus control needs seconds-level Charger power. The car offers minutes-level values at best (stored overview) or wake-ups that are slow and can drain the 12 V battery. That cadence is far too slow for a Surplus source.

### Authentication and its stability

- OAuth2 authorization code flow against Auth0, impersonating the app's public client ID. Scopes include `offline_access`, `charging` and `manageCharging`. [evcc const.go][evcc-const]
- Login is "identifier first" with **a captcha (SVG image) that a human must solve**. pyp writes it to an HTML file for the user. evcc shows it in its UI and resumes the flow. HA asks for it during setup. After that, a **refresh token** (which rotates) keeps the session alive without a captcha. [evcc login.go][evcc-login], [pyp cli.py][pyp], [PR #100][pyp-100]
- No MFA/OTP step appears in the clients. They do have to **decline a passkey-enrolment screen** that Auth0 interleaves. [PR #96][pyp-96]
- Breaking changes found:
  - 2023: "New authentication scheme" and captcha problems. [pyp issues][pyp-issues]
  - June 2024: the entire old API was retired. [#46][pyp-46]
  - 2026: Auth0 began requiring PKCE. [#96][pyp-96]
  - About 5 Nov 2026: Porsche removed the app's custom-scheme redirect URI. "Every login fails. The stored refresh token is rejected." The fix was a new HTTPS app-link redirect, and every install needs one fresh login with captcha. Only the `en-GB` callback path is registered. [PR #100][pyp-100]
- **(inferred)** Expect breakage every few months, each time a manual re-login with captcha. A self-hosted backend must survive the car source disappearing for days and must offer a way to enter a captcha.

### Terms-of-use and account risk

- The developer portal terms forbid scrapers and reverse engineering, but their scope is the business-only developer portal. [Developer terms][dev-terms]
- We could not extract the consumer My Porsche / Porsche Connect T&C (the UK PDF did not render to text), so **no automated-access clause is confirmed or ruled out**. See open questions. [UK T&C PDF][uk-tc]
- Every unofficial client carries a disclaimer: "not officially supported by Porsche and functionality can stop working at any time without warning." [pyp README][pyp]
- No reports of Porsche banning accounts for this use were found. `ACCOUNT_LOCKED` (423) and 429 responses exist, though. **(inferred)** Risk is low to moderate for one household polling every 15–30 min. Aggressive polling or frequent wake-ups raise it. Using a dedicated secondary My Porsche user, if Porsche allows one on the vehicle, would limit the blast radius.

### TypeScript

- No maintained TypeScript or Node client was found. npm `porsche-connect` (repo `martijndierckx/node-porsche-connect`) was last published 2024-02-18, before the June 2024 API retirement. **(inferred)** It is defunct. `npm view porsche-connect`, [pyp #46][pyp-46]
- **(inferred)** A TypeScript port is small. It takes an Auth0 login with PKCE, a captcha hand-off, refresh-token persistence, and one GET. evcc's `vehicle/porsche` (about 1,100 lines of Go, most of it the captcha login flow) is the cleanest reference. The alternative is to run evcc or HA as a sidecar and read their values.

## Open questions

1. Does the Porsche Data Hub (data.porsche.com) let an individual owner act as their own third party with API access? At what latency? This is the only official path and is worth checking by logging in.
2. What does the consumer Porsche Connect / My Porsche T&C for the Netherlands say about automated or third-party-app access?
3. How quickly does the Macan Electric push `CHARGING_RATE` / `BATTERY_LEVEL` to the backend while AC-charging without a wake-up? This needs measuring on the real car: log the stored overview every 5 min during one charge session.
4. How closely does the car's `chargingPower` track Zaptec's Charger power (offset, rounding, lag)?
5. Can a secondary My Porsche user be added to the Macan to isolate account risk?
6. Do repeated `wakeUpJob` calls measurably drain the 12 V battery or interfere with charging? evcc's `wakeupdisabled` hint suggests some vehicles "refuse to charge after repeated wake-ups". [evcc docs][evcc-docs]

[dev-faq]: https://developer.porsche.com/faq
[dev-terms]: https://developer.porsche.com/terms
[nl-dataact]: https://www.porsche.com/netherlands/nl/eu-data-act/
[hm]: https://docs.high-mobility.com/oem-guides/porsche
[store-nl]: https://connect-store.porsche.com/offer/nl/en-NL/macan_2024/products/bundle_connect_v4
[uk-tc]: https://assets-prod.porsche.com/market/legal-documents/gb/en-GB/TermsAndConditions.pdf
[pyp]: https://github.com/CJNE/pyporscheconnectapi
[pyp-const]: https://github.com/CJNE/pyporscheconnectapi/blob/dd13985ea0ad1f73beed8377990569eab7967cf8/pyporscheconnectapi/const.py
[pyp-vehicle]: https://github.com/CJNE/pyporscheconnectapi/blob/dd13985ea0ad1f73beed8377990569eab7967cf8/pyporscheconnectapi/vehicle.py
[pyp-exc]: https://github.com/CJNE/pyporscheconnectapi/blob/dd13985ea0ad1f73beed8377990569eab7967cf8/pyporscheconnectapi/exceptions.py
[pyp-issues]: https://github.com/CJNE/pyporscheconnectapi/issues?q=is%3Aissue
[pyp-46]: https://github.com/CJNE/pyporscheconnectapi/issues/46
[pyp-63]: https://github.com/CJNE/pyporscheconnectapi/issues/63
[pyp-96]: https://github.com/CJNE/pyporscheconnectapi/pull/96
[pyp-100]: https://github.com/CJNE/pyporscheconnectapi/pull/100
[ha]: https://github.com/CJNE/ha-porscheconnect
[ha-const]: https://github.com/CJNE/ha-porscheconnect/blob/main/custom_components/porscheconnect/const.py
[ha-sensor]: https://github.com/CJNE/ha-porscheconnect/blob/main/custom_components/porscheconnect/sensor.py
[evcc-src]: https://github.com/evcc-io/evcc/tree/073384c7f33cbdea2c7813c01efb13d84db6597d/vehicle/porsche
[evcc-const]: https://github.com/evcc-io/evcc/blob/073384c7f33cbdea2c7813c01efb13d84db6597d/vehicle/porsche/const.go
[evcc-api]: https://github.com/evcc-io/evcc/blob/073384c7f33cbdea2c7813c01efb13d84db6597d/vehicle/porsche/api.go
[evcc-types]: https://github.com/evcc-io/evcc/blob/073384c7f33cbdea2c7813c01efb13d84db6597d/vehicle/porsche/types.go
[evcc-provider]: https://github.com/evcc-io/evcc/blob/073384c7f33cbdea2c7813c01efb13d84db6597d/vehicle/porsche/provider.go
[evcc-login]: https://github.com/evcc-io/evcc/blob/073384c7f33cbdea2c7813c01efb13d84db6597d/vehicle/porsche/login.go
[evcc-tpl]: https://github.com/evcc-io/evcc/blob/073384c7f33cbdea2c7813c01efb13d84db6597d/templates/definition/vehicle/porsche.yaml
[evcc-docs]: https://docs.evcc.io/en/vehicles/porsche
