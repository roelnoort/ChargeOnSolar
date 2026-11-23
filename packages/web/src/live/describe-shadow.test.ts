import type {
  ShadowDecision,
  ShadowDecisionRecord,
} from "@charge-on-solar/shared";
import { describe, expect, it } from "vitest";
import { describeShadowDecision } from "./describe-shadow.ts";

function record(
  decision: ShadowDecision,
  overrides: Partial<ShadowDecisionRecord> = {}
): ShadowDecisionRecord {
  return {
    at: "2026-06-01T12:01:00.000Z",
    decision,
    chargingCurrentA: null,
    phaseSetting: 1,
    inputs: {
      surplusW: 3300,
      netPowerW: -3300,
      solarProductionW: null,
      chargerPowerW: 0,
      fuseHeadroomA: 12.4,
      startWindowSurplusW: 3300,
      stopWindowSurplusW: 1100,
      dataAgeMs: { p1: 1000, charger: 20_000, solar: null },
    },
    zaptec: {
      availableCurrentMode: 2,
      enabledFeatures: null,
      surplusModeActive: false,
      chargeCurrentSetA: 16,
    },
    rulesVersion: 1,
    settings: {
      startWindowMinutes: 5,
      stopWindowMinutes: 10,
      minimumOnTimeMinutes: 15,
      minimumOffTimeMinutes: 15,
      currentHoldMinutes: 15,
      deadBandAmps: 1,
      voltage: 230,
      tickIntervalSeconds: 60,
      mainFuseAmps: 25,
      minimumSolarWatts: 0,
      solarMode: "solar-only",
    },
    ...overrides,
  };
}

const sentenceFor = (
  decision: ShadowDecision,
  overrides?: Partial<ShadowDecisionRecord>
) => describeShadowDecision(record(decision, overrides)).sentence;

describe("the Shadow decision sentence", () => {
  it("names the Charging current and the Surplus that limits it", () => {
    expect(
      sentenceFor(
        { kind: "start", currentAmps: 14, limitedBy: "surplus" },
        { chargingCurrentA: 14 }
      )
    ).toBe(
      "Would charge at 14 A, limited by Surplus: 3.30 kW on average over 5 minutes"
    );
  });

  it("says the same for a change of Charging current", () => {
    expect(
      sentenceFor(
        { kind: "change-current", currentAmps: 14, limitedBy: "surplus" },
        { chargingCurrentA: 14 }
      )
    ).toBe(
      "Would charge at 14 A, limited by Surplus: 3.30 kW on average over 5 minutes"
    );
  });

  it.each([
    ["charger-maximum", 16, "Would charge at 16 A, the charger's maximum"],
    [
      "fuse-headroom",
      12,
      "Would charge at 12 A, limited by Fuse headroom: 12.4 A",
    ],
    [
      "minimum-current",
      6,
      "Would charge at 6 A, the charger's minimum, with Surplus at 3.30 kW on average over 5 minutes",
    ],
  ] as const)("names the %s limit", (limitedBy, currentAmps, sentence) => {
    expect(
      sentenceFor(
        { kind: "start", currentAmps, limitedBy },
        { chargingCurrentA: currentAmps }
      )
    ).toBe(sentence);
  });

  it("says 'No car' when the car is unplugged", () => {
    expect(sentenceFor({ kind: "no-car" })).toBe("No car");
  });

  it("says the car is not taking a charge", () => {
    expect(sentenceFor({ kind: "car-not-accepting" })).toBe(
      "The car is not taking a charge"
    );
  });

  it.each([
    ["surplus-too-low", "Would not charge (Surplus below 6 A)"],
    [
      "minimum-off-time",
      "Would not charge (waiting out the minimum off-time of 15 minutes)",
    ],
    ["switch-budget", "Would not charge (the Switch budget is used up)"],
    ["fuse-headroom", "Would not charge (Fuse headroom below 6 A)"],
  ] as const)("explains holding off for %s", (reason, sentence) => {
    expect(sentenceFor({ kind: "hold", reason })).toBe(sentence);
  });

  it("says the Surplus is too low, not below 6 A, in All solar", () => {
    const settings = { ...record({ kind: "no-car" }).settings };
    expect(
      sentenceFor(
        { kind: "hold", reason: "surplus-too-low" },
        { settings: { ...settings, solarMode: "all-solar" } }
      )
    ).toBe("Would not charge (no Surplus)");
  });

  it.each([
    [
      "minimum-on-time",
      "Would keep charging at 10 A (Surplus too low, but within the minimum on-time of 15 minutes)",
    ],
    [
      "within-dead-band",
      "Would keep charging at 10 A (the Surplus has not changed enough to adjust)",
    ],
    [
      "current-hold",
      "Would keep charging at 10 A (holding each Charging current for 15 minutes)",
    ],
  ] as const)(
    "explains holding a Charging current for %s",
    (reason, sentence) => {
      expect(
        sentenceFor({ kind: "hold", reason }, { chargingCurrentA: 10 })
      ).toBe(sentence);
    }
  );

  it.each([
    [
      "surplus-too-low",
      "Would stop charging (Surplus: 1.10 kW on average over 10 minutes, below 6 A)",
    ],
    ["fuse-headroom", "Would stop charging (Fuse headroom below 6 A)"],
  ] as const)("explains stopping for %s", (reason, sentence) => {
    expect(sentenceFor({ kind: "stop", reason })).toBe(sentence);
  });

  it("says 'Paused by you', with the decision underneath it", () => {
    expect(
      describeShadowDecision(
        record({
          kind: "paused",
          underlying: { kind: "start", currentAmps: 14, limitedBy: "surplus" },
        })
      )
    ).toEqual({
      sentence: "Paused by you",
      withoutPause:
        "Would charge at 14 A, limited by Surplus: 3.30 kW on average over 5 minutes",
    });
  });
});
