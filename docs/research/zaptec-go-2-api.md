# Zaptec Go 2 API capabilities

Research for issue #2. Question: what can ChargeOnSolar read from and send to a Zaptec Go 2, and which rules limit realistic Shadow decisions?

Researched 2026-11-19, against Zaptec's official developer docs (docs.zaptec.com) and the Zaptec Go 2 user manual. Each claim cites its source. Anything marked **(inferred)** is our own reading of the sources, not something Zaptec states.

## TL;DR for Shadow decisions

| Rule | Value | Source |
|---|---|---|
| Recommended control knob | Installation `availableCurrent` (or per-phase `availableCurrentPhase1..3`), not charger-level current | [Update charger][charger-update], [Dynamic load balancing][dlb] |
| Max change rate for `availableCurrent` | No more than once every **15 minutes**. More often may make the car interrupt the session. | [Update installation][inst-update], [Usage guidelines][guidelines], [DLB][dlb] |
| Max change rate for the phase setting | No more than once every **15 minutes** | [3-to-1 phase switching][phase] |
| Effect latency | Takes effect immediately; vehicles adjust within **5 s** | [Update installation][inst-update] |
| Minimum Charging current | Charger minimum is "usually **6 A**" (`minChargeCurrent` defaults to 6 A). Below it, the charger gets no current and does not charge. | [Update charger][charger-update] |
| Maximum Charging current | **32 A** (charger `maxChargeCurrent` range 0–32). The Go 2 is rated 32 A: 22 kW 3-phase TN, 7.4 kW 1-phase. | [Update charger][charger-update], [Go 2 manual][manual] |
| Phase switching | Go 2 can switch 3-phase to 1-phase (L1) and back, controlled through the installation's `threeToOnePhaseSwitchCurrent`: `0` = always 3-phase, `32` = always 1-phase, `6–31` = load balancer decides | [Phase switching][phase] |
| Session switching budget | At most **20 switching operations per charge session** (mechanical limit). Every interruption counts, including start/stop and 3↔1 switches. The limit ends the session with a warning. Returns to 3-phase are separately capped by "Switches allowed before locking to single phase" (default 5, max 20). | [Phase switching][phase] |
| Smallest worthwhile current change | Avoid changes under **0.10 A** | [Pause/resume approaches][approaches] |
| API rate limit | **10 req/s per user**, burst 15. Token endpoint **1 req/s per IP**. A `429` comes with `Retry-After: 1`. | [Rate limiting][ratelimit] |

**(inferred)** What this means for Shadow decisions:
- A Shadow decision that changes the current should not be possible more than once per 15 minutes. Solar surplus moves faster than that, so the rule needs hysteresis or averaging, not a 1:1 tracking of each Reading.
- The minimum charging power is about 6 A × 230 V ≈ 1.4 kW on 1 phase and ≈ 4.1 kW on 3 phases. Surplus between those two is only usable on 1 phase.
- Start/stop decisions and phase switches use up the per-session budget of 20 switching operations. Shadow decisions should count them and avoid flapping.

## Cloud API vs local API

- **Cloud REST API** at `https://api.zaptec.com/`. This is the documented way to read state and control a Go 2 under Zaptec's own load balancing. [Getting started / overview][overview], [Authentication][auth]
- **Service Bus (AMQP 1.0, Azure Service Bus)** pushes state changes per User Group. Zaptec recommends it over polling for real-time use. [Service Bus][servicebus]
- **No local LAN/Modbus API is documented** for the Go 2. Zaptec's developer docs list none ([doc index][llms]). **(inferred)** We should treat the Go 2 as cloud-only for v1.
- **OCPP 1.6J native (box-level)** connects the charger directly to a third-party central system (CSMS), which could be self-hosted. Zaptec says this mode "does not support Zaptec's proprietary and more advanced phase and load balancing features" ([OCPP within Zaptec][ocpp]). The Go/Go 2 OCPP key list shows SmartCharging with rate unit Current only, and no phase-switching key ([Go/Go 2 OCPP keys][ocppkeys]). Phase switching also requires that "OCPP 1.6J Native authentication [is] not enabled" ([Phase switching][phase]). **(inferred)** OCPP native is not a fit for v1: it would give up 3↔1 switching and the Zaptec app's normal mode.
- The Go 2 and the Pro behave essentially the same in the API and Service Bus. The original Go does not switch phases. [Service Bus/LB FAQ][faq]

## Authentication and token lifetime

- `POST https://api.zaptec.com/oauth/token`, `application/x-www-form-urlencoded`, `grant_type=password`, plus `username` and `password` (ROPC). The response holds a `Bearer` `access_token` with `expires_in: 3600` (1 hour). No refresh token is documented: request a new token before expiry. [Authentication][auth]
- Zaptec says the password grant "will be phased out in favor of the OAuth 2.0 Code grant". [Authentication][auth]
- Fair-use policy: do not capture or store users' credentials. Use the documented third-party onboarding (lookup key) flow. [Fair use][fairuse] **(inferred)** That rule targets third-party apps. A self-hosted single-household system logging in with the owner's own (service) account is the authentication page's own example, but we should expect a migration to the Code grant.
- Third-party onboarding gives a User Group **owner and service** access to the installation. [Lookup key flow][lookup]
- Every request must send a `User-Agent` of the form `AppName/Version`. Only documented endpoints may be used. [Fair use][fairuse]
- Commands and settings need **Owner or Service** role on the charger or installation. [Send command][command], [Update installation][inst-update]

## Reading charger state and live power/current

- `GET /api/chargers/{id}/state` returns an array of `{chargerId, stateId, stateName, timestamp, valueAsString}`. Requires Owner/Service. [Charger state][state]
- Zaptec advises **against** using this endpoint for real-time tracking or aggressive polling, and recommends the Service Bus. No numeric polling interval is given. [DLB][dlb], [Usage guidelines][guidelines], [Fair use][fairuse]
- Fetch installation and charger lists at most **once an hour** and cache them. [Fair use][fairuse]
- The Service Bus sends a `ChargerState` JSON (`ChargerId`, `StateId`, `Timestamp`, `ValueAsString`) **only when a value changes**, not on a fixed interval. [Service Bus][servicebus], [FAQ][faq]
  - Access must be **activated through Zaptec Support or a business representative**. Connection details come from `GET /api/userGroups/{id}/messagingConnectionDetails`.
  - Unconsumed messages expire after 5 minutes. A subscription is disabled after 14 days without traffic.
  - At most two subscriptions per installation receive messages.
- Useful observation IDs ([State observation reference][observations]; full list at `GET /api/constants` ([Constants][constants])):

| ID | Name | Unit / values |
|---|---|---|
| -2 | IsOnline | 1/0 |
| 501–503 | VoltagePhase1–3 | V |
| 507–509 | CurrentPhase1–3 | A (per-phase current) |
| 513 | TotalChargePower | W |
| 519 | SetPhases | 1/2/3 = TN single phase L1/L2/L3, 4 = TN 3-phase (IT values 5, 6, 8) |
| 553 | TotalChargePowerSession | kWh this session |
| 708 | ChargeCurrentSet | A currently allocated |
| 710 | ChargerOperationMode | 1 = disconnected, 2 = connected/requesting, 3 = charging, 5 = connected/finished or paused |
| 718 | FinalStopActive | 1 = paused/scheduled stop ([Pause/resume][pause]) |
| 721 / 722 | SessionIdentifier / ChargerCurrentUserUuid | session / authorization |
| 763 | NextScheduleEvent | if set, Resume is rejected ([Pause/resume][pause]) |

- The model has no public field. A Go 2 is identified by serial prefix **GPN, GPG or GPH**. [Identify device types][devices], [FAQ][faq]

## Commands (start, pause/stop, current, phases)

`POST /api/chargers/{id}/sendCommand/{commandId}` (Owner/Service) ([Send command][command]):

| ID | Command | Precondition |
|---|---|---|
| 506 | Stop/pause charging (StopChargingFinal) | 710 = 3 (charging). Rejected if already paused or disconnected. |
| 507 | Resume charging | 710 = 5 **and** 718 = 1 **and** no 763. Otherwise rejected (code 528). |
| 10001 | Deauthorize and stop | Ends the session. The EV must re-authorize. |
| 102 / 200 | Restart / firmware upgrade | Not relevant |

- Commands are rejected when the charger is in a state where they would do nothing, and they usually fail at once if the charger is offline. [Approaches][approaches], [Command validation update][validation]
- There is **no separate "start" command**. Charging starts when a car connects and is authorized. 507 resumes a session paused with 506. Do not send 507 in mode 2 unless 506 caused the pause. [Approaches][approaches]
- **Alternative pause:** set the current below 6 A (pause) and back to 6 A or more (resume). Pick one method per session. Zaptec calls the commands "most deterministic and robust". [Approaches][approaches]
- **Set Charging current:** use installation `availableCurrent`. Charger-level `maxChargeCurrent` (0–32) / `minChargeCurrent` exist, but Zaptec says they "should generally not be used" because they override the load balancer. [Update charger][charger-update]
- **Phases:** charger `maxChargePhases` (1 or 3) caps the phases. Dynamic choice goes through installation `threeToOnePhaseSwitchCurrent`. For solar, Zaptec advises a threshold above your expected maximum solar current (example: 6 kW array ≈ 9 A per phase gives threshold 9), or 8 A if unknown, so solar charging stays on 1 phase and does not flap. [Phase switching][phase]
- Prerequisite for API load balancing: the installation must be in **Default** charging mode (`AvailableCurrentMode` 0, not 1 = Scheduled or 2 = APM). [DLB][dlb]

## Installation-level vs charger-level settings

| Level | Endpoint | Fields | Notes |
|---|---|---|---|
| Installation | `POST /api/installation/{id}/update` | `availableCurrent` or `availableCurrentPhase1/2/3`, `maxCurrent` (electrician/Service only), `threeToOnePhaseSwitchCurrent`, `minPowerOfflineMode` | Recommended control surface. Sets the budget the Zaptec load balancer splits over the chargers. Cannot exceed `maxCurrent` (fuse). `null` reverts to `maxCurrent`. Mode 3: applies at once. Mode 2: applies when charging starts. Mode 5: future sessions. [Update installation][inst-update], [FAQ][faq] |
| Charger | `POST /api/chargers/{id}/update` | `maxChargeCurrent` (0–32), `minChargeCurrent` (default 6), `maxChargePhases` (1/3), `offlineChargeCurrent`, `offlineChargePhase`, `meterValueInterval` | Per-charger hard limits that override the load balancer. Zaptec advises against using them for control. [Update charger][charger-update] |

**(inferred)** For a one-charger home, setting installation `availableCurrent` is in effect "set Charging current", but it is a ceiling: the car may draw less. Shadow decisions should be phrased as an installation `availableCurrent` (A per phase) plus a phase mode.

## Open questions

- No minimum current is published for the Go 2 itself. 6 A is the charger default `minChargeCurrent`, and IEC 61851 sets the same floor. We have not verified a Go 2 datasheet value.
- Whether Zaptec grants Service Bus access to a private homeowner is not documented. Without it we must poll `/state`, but no safe polling interval is published. **(inferred)** Every 30–60 s is far below 10 req/s, but the policy forbids "aggressive" polling without defining it.
- The docs do not say whether the 15-minute guidance also applies to pause/resume commands. They only warn against "frequent or rapid updates" and the 20-switch session limit.

## Sources

[overview]: https://docs.zaptec.com/docs/overview
[llms]: https://docs.zaptec.com/llms.txt
[auth]: https://docs.zaptec.com/docs/api-authentication
[guidelines]: https://docs.zaptec.com/docs/api-usage-guidelines
[fairuse]: https://docs.zaptec.com/docs/api-fair-use-policy
[ratelimit]: https://docs.zaptec.com/docs/api-rate-limiting
[devices]: https://docs.zaptec.com/docs/identify-device-types
[lookup]: https://docs.zaptec.com/docs/step-by-step-flow-granting-third-party-access-to-user-installations-via-lookup-key
[dlb]: https://docs.zaptec.com/docs/dynamic-load-balancing-with-the-zaptec-api
[phase]: https://docs.zaptec.com/docs/3-to-1-phase-switching-with-zaptec-go-2
[pause]: https://docs.zaptec.com/docs/understanding-finalstopactive-and-resume-command-behavior
[approaches]: https://docs.zaptec.com/docs/approaches-to-start-and-stop-charging-during-a-session
[servicebus]: https://docs.zaptec.com/docs/zaptec-service-bus-subscriptions
[observations]: https://docs.zaptec.com/docs/state-observation-reference
[faq]: https://docs.zaptec.com/docs/zaptec-load-balancing-telemetry-developer-faq
[ocpp]: https://docs.zaptec.com/docs/ocpp-within-zaptec
[ocppkeys]: https://docs.zaptec.com/docs/zaptec-go2-ocpp-16j-supported-configuration-keys
[state]: https://docs.zaptec.com/reference/api_chargers_id_state_get
[command]: https://docs.zaptec.com/reference/api_chargers_id_sendcommand_commandid_post
[charger-update]: https://docs.zaptec.com/reference/api_chargers_id_update_post
[inst-update]: https://docs.zaptec.com/reference/api_installation_id_update_post
[constants]: https://docs.zaptec.com/reference/api_constants_get
[validation]: https://docs.zaptec.com/page/charger-command-validation-update
[manual]: https://help.zaptec.com/objects/sa-migration-assets/aaffa4be-5f88-4e9a-9a9e-c16298de05c7/fc09d40fb73d40e428e1543cf8111565e60c2e68e1583397939236cf132340ea.pdf

- Overview: <https://docs.zaptec.com/docs/overview>
- Authentication: <https://docs.zaptec.com/docs/api-authentication>
- API usage guidelines: <https://docs.zaptec.com/docs/api-usage-guidelines>
- API fair use policy: <https://docs.zaptec.com/docs/api-fair-use-policy>
- API rate limiting: <https://docs.zaptec.com/docs/api-rate-limiting>
- Dynamic load balancing: <https://docs.zaptec.com/docs/dynamic-load-balancing-with-the-zaptec-api>
- 3- to 1-phase switching with Zaptec Go 2: <https://docs.zaptec.com/docs/3-to-1-phase-switching-with-zaptec-go-2>
- Pause and resume: <https://docs.zaptec.com/docs/understanding-finalstopactive-and-resume-command-behavior>, <https://docs.zaptec.com/docs/approaches-to-start-and-stop-charging-during-a-session>
- Service Bus: <https://docs.zaptec.com/docs/zaptec-service-bus-subscriptions>, FAQ: <https://docs.zaptec.com/docs/zaptec-load-balancing-telemetry-developer-faq>
- State observations: <https://docs.zaptec.com/docs/state-observation-reference>
- OCPP: <https://docs.zaptec.com/docs/ocpp-within-zaptec>, <https://docs.zaptec.com/docs/zaptec-go2-ocpp-16j-supported-configuration-keys>
- API reference: charger state, send command, update charger, update installation (links above)
- Zaptec Go 2 user manual (PDF): see `[manual]` link above
