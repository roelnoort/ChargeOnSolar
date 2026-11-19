# Zaptec Sense: role and interplay with external control

Research for issue #3. Researched 2026-11-19. Setup in scope: one Zaptec Go 2, one Zaptec Sense, Enphase solar, HomeWizard P1 meter (Netherlands).

## Short answer

- **Sense is a building-load meter that feeds Zaptec's cloud load balancer.** It reads the house's grid connection, and Zaptec Cloud computes the charger's available current as *main fuse minus measured building load*. Its job is protecting the main fuse.
- **Zaptec has its own solar-surplus charging, built on Sense.** It's called "Surplus mode" (APM feature `PowerManagement_Apm_SurplusMode`) and is offered in NL/BE/DE/CH/LU on TN grids with Sense Generic or Sense P1.
- **External control and Sense don't stack cleanly over the REST API.** External load balancing through `POST /api/installation/{id}/update` (`AvailableCurrent`) is documented as needing **Default** mode. When APM (the Sense-driven mode) is active, Zaptec says to treat external control as **not supported**. Over **OCPP 1.6J** the two do stack: the lower of the CSMS profile and the Sense-based limit wins.
- **Sense readings are probably not readable by a third party.** The API's constants define Sense observations (phase currents, voltage, active power, import/export energy), but no documented public endpoint or Service Bus stream exposes them. So Sense can't replace the HomeWizard P1 as ChargeOnSolar's measurement source. It can complement it, as an independent fuse guard inside Zaptec.

## 1. What Sense measures and what it does

- Zaptec describes Sense as a device that reads the building's energy use and regulates charging speed. Variants cover different meter ports: HAN (Scandinavia), P1 (BeNeLux and others), plus a "Generic" CT/Modbus variant. [zaptec.com: Load balancing with Zaptec Sense](https://www.zaptec.com/charging-solutions/zaptec-sense)
- The portal setting "Automatic charging with Zaptec Sense" balances EV charging against the main fuse. The available current is `Main fuse (A) − building load measured by Sense`. Sense can reduce EV charging but cannot limit other loads. [Help Centre: How to manage Zaptec Sense in the Zaptec Portal](https://help.zaptec.com/smart-charging/how-to-manage-zaptec-sense-in-the-zaptec-portal) *(JS-rendered page. Content seen through the search index, not a direct fetch.)*
- For Sense P1, the meter's P1 port must be enabled. Compatibility depends on the protocol the grid operator configured on that meter. [Help Centre: How to install Zaptec Sense with P1 connectivity](https://help.zaptec.com/installation/how-to-install-zaptec-sense-with-p1-connectivity) *(through the search index)*
- Without Sense, Zaptec can still share power between chargers on a circuit. It cannot protect the main fuse from real-time building load. [Help Centre: Zaptec load balancing with Zaptec Sense over OCPP 1.6J](https://help.zaptec.com/smart-charging/zaptec-load-balancing-with-zaptec-sense-over-ocpp-1-6j-how-it-works-and-how-to-get-started) *(through the search index)*

**Data model (primary: `GET https://api.zaptec.com/api/constants`, version 6.5.8).**
- Sense devices appear as their own device types: `HomeApm`=3, `OtherApm`=5, `GenericApm`=6, `HanApm`=7, `TicApm`=8. Chargers are `Apollo`=4 (Go/Go 2) and `Smart`=1 (Pro/Home).
- The `HomeApm` (P1/HAN) observation schema includes:
  - `VoltagePhase1-3` (501-503) and `CurrentPhase1-3` (507-509)
  - `ActivePowerKw` (1161) and `PowerAveragingPeriod` (1160)
  - `AMSCumulativeEnergyImport/Export` (1020/1021) and `AMSHourlyEnergyImport/Export` (1010/1011)
  - `DSMRP1Version` (1130), `SenseStatusMessage` (1133), `TransmitIntervalSensorReading` (1134) and `IsOnline` (-2)

  So Sense measures per-phase current and voltage, active power, and import/export energy from the smart meter.

## 2. Are Sense measurements readable through the API?

**Not through any documented public path.**
- The documented real-time channel is the Service Bus (AMQP) subscription. Its messages are `ChargerState` objects keyed by `ChargerId`, described as "charger state updates". Access must be requested from Zaptec Support or a business representative. [docs: Zaptec Service bus subscriptions](https://docs.zaptec.com/docs/zaptec-service-bus-subscriptions)
- The State Observation Reference lists only charger observations. Nothing in it covers building, grid or Sense data. [docs: State Observation Reference](https://docs.zaptec.com/docs/state-observation-reference)
- The docs index (`llms.txt`) has no Sense/APM API page. The only Sense entry is a firmware changelog. [docs.zaptec.com/llms.txt](https://docs.zaptec.com/llms.txt)
- What *is* readable is configuration and status at installation level, via `GET /api/installation/{id}` [reference](https://docs.zaptec.com/reference/api_installation_id_get):
  - `availableCurrentMode`
  - the `enabledFeatures` bitmask (includes `PowerManagement_Apm`, `PowerManagement_Apm_SurplusMode`)
  - `propertyEnergySensorIsOffline`
  - `feature_PowerManagement_Apm_*`
  - `surplusMode { active, available, enabled, strategy (0=PartialPower, 1=Full), partialPowerKw }`

**Unverified:** whether Sense observations are visible through an undocumented endpoint, or in Service Bus messages for an installation with Sense. The schema exists in `/api/constants`, so it might be. Only a test against the real installation can settle this.

## 3. Zaptec's own solar/surplus charging

- Available for Sense Generic and Sense P1 in the Netherlands, Belgium, Germany, Switzerland and Luxembourg, on residential TN-grid installations. Sense must have detected local production. HAN and TIC Sense don't support it yet. [Help Centre: How to use solar charging with Zaptec Sense](https://help.zaptec.com/smart-charging/how-to-use-solar-charging-with-zaptec-sense) and [Zaptec news: home solar charging](https://www.zaptec.com/info-hub/industry-news/zaptec-home-solar-charging) *(both through the search index)*
- Modes are "Surplus only" and surplus plus grid. The API's `SurplusStrategy` enum, `PartialPower` with `partialPowerKw` or `Full`, maps to these. Surplus only starts at the minimum current, about 6 A per phase. That means roughly 1.4 kW of surplus on 1-phase and 4.1-4.2 kW on 3-phase. (Same sources.)
- Zaptec warns against running several smart controls at once: solar charging, Eco mode, third-party apps, OCPP systems and car schedules. It also says third-party solar/EMS systems can still integrate through OCPP or the API. (Same sources.)
- For Go 2 with solar, Zaptec recommends setting the 3→1 phase-switch threshold above the maximum expected solar current, 8 A if unknown. [docs: 3- to 1-phase switching with Zaptec Go 2](https://docs.zaptec.com/docs/3-to-1-phase-switching-with-zaptec-go-2)

## 4. Do external current commands conflict with, or get capped by, Sense?

**REST API (`AvailableCurrent`)**
- External dynamic load balancing requires the installation in **Default Charging Mode** (`availableCurrentMode` = 0). [docs: Dynamic load balancing](https://docs.zaptec.com/docs/dynamic-load-balancing-with-the-zaptec-api) and [docs: Solar Integration with Zaptec Go and Go 2](https://docs.zaptec.com/docs/solar-integration-and-zaptec)
- FAQ Q5.1/Q5.2 [docs: Service Bus and Load Balancing FAQ](https://docs.zaptec.com/docs/zaptec-load-balancing-telemetry-developer-faq):
  - APM shows as `availableCurrentMode` = 2 plus the `PowerManagement_Apm` bit.
  - When Eco, Schedule or APM is active, "internal power management is expected to be in control". Treat external load balancing as "not supported". External updates "may be rejected or behave unexpectedly" (for example business error 527).
  - Recommended: allow external load balancing only when Default mode is on and Eco/APM/Schedule are off.
- In every mode, the effective current is the **lowest** of these limits (FAQ Q1.4, Q6.4):
  - the vehicle limit
  - the cable rating
  - installation limits (`AvailableCurrent`, load balancing)
  - the charger's `ChargeMaxCurrent`
  - the main breaker, the charging-system breaker or APM bracket, and `maxCurrent`
- `AvailableCurrent` should change at most once per 15 min. Vehicles adjust within about 5 s. [reference: Update installation](https://docs.zaptec.com/reference/api_installation_id_update_post)

**OCPP 1.6J with Sense** (Go firmware ≥ 2.6.1.7, Go 2 ≥ 3.4.0.3, Sense ≥ 7.0.0.8)
- Zaptec Cloud keeps fuse protection based on Sense while a third-party CSMS sends charging profiles. The final current is **min(CSMS profile, Zaptec Sense limit)**. Removing the TxDefaultProfile hands control back to Zaptec's load balancing. [Help Centre: Zaptec load balancing with Zaptec Sense over OCPP 1.6J](https://help.zaptec.com/smart-charging/zaptec-load-balancing-with-zaptec-sense-over-ocpp-1-6j-how-it-works-and-how-to-get-started) *(through the search index)*
- This is the only documented path where external control **and** Sense fuse protection run at the same time, with Sense acting as a cap.

**Implication for ChargeOnSolar:** a future automatic controller must make a choice:
- **(a) REST `AvailableCurrent` in Default mode.** This likely means Sense/APM is not the active mode, so the main-fuse guard moves into our own logic.
- **(b) OCPP 1.6J CSMS with Sense kept as the fuse cap.** ChargeOnSolar would become a CSMS.
- **(c) Zaptec's built-in Surplus mode with no external control.** ChargeOnSolar would only monitor.

For v1, which only monitors and shadows, no conflict arises. Reading the installation's `availableCurrentMode`, `enabledFeatures` and `surplusMode` is enough to show which controller is really in charge.

## 5. Can Sense replace or complement the HomeWizard P1?

- **Replace: no.** No documented API exposes Sense readings (section 2), and real-time data goes through Zaptec's cloud anyway. The HomeWizard P1 has a local API (see issue #5).
- **Complement: yes.** Sense gives Zaptec its own view of building load, so the fuse stays protected inside Zaptec even if ChargeOnSolar is down. That only holds while APM/Sense control is the active mode, or in the OCPP + Sense setup.
- **Physical P1 port contention (inference, not verified against a primary source):** a Sense P1 and a HomeWizard P1 both plug into the meter's single P1 port. Find out how the existing Sense is connected (P1 or Generic/CT) before assuming both can read the same meter. A P1 splitter is a common answer, but neither vendor's docs were checked for that here.

## Open questions / verify on the real installation

1. What `GET /api/installation/{id}` returns for this house: `availableCurrentMode`, `enabledFeatures`, `surplusMode`, and the Sense device type.
2. Whether Sense observations (e.g. `ActivePowerKw` 1161, `CurrentPhase1-3`) show up through any API call or Service Bus message for this installation.
3. Whether `POST /api/installation/{id}/update` is rejected (527?) or silently overridden while APM is active.

## Sources

Primary, fetched directly:
- https://api.zaptec.com/api/constants (API v6.5.8)
- https://docs.zaptec.com/docs/zaptec-load-balancing-telemetry-developer-faq (updated 2026-10-01)
- https://docs.zaptec.com/docs/dynamic-load-balancing-with-the-zaptec-api (updated 2026-07-06)
- https://docs.zaptec.com/docs/solar-integration-and-zaptec
- https://docs.zaptec.com/reference/api_installation_id_get (updated 2026-06-16)
- https://docs.zaptec.com/reference/api_installation_id_update_post
- https://docs.zaptec.com/docs/zaptec-service-bus-subscriptions (updated 2026-09-02)
- https://docs.zaptec.com/docs/state-observation-reference
- https://docs.zaptec.com/docs/3-to-1-phase-switching-with-zaptec-go-2 (updated 2026-07-10)

Primary, but help.zaptec.com renders client-side, so content was taken from search-index excerpts. Re-check in a browser:
- https://help.zaptec.com/smart-charging/how-to-use-solar-charging-with-zaptec-sense
- https://help.zaptec.com/smart-charging/zaptec-load-balancing-with-zaptec-sense-over-ocpp-1-6j-how-it-works-and-how-to-get-started
- https://help.zaptec.com/smart-charging/how-to-manage-zaptec-sense-in-the-zaptec-portal
- https://help.zaptec.com/installation/how-to-install-zaptec-sense-with-p1-connectivity
- https://www.zaptec.com/info-hub/industry-news/zaptec-home-solar-charging
- https://www.zaptec.com/charging-solutions/zaptec-sense
