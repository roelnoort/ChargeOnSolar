import type {
  DayOverride,
  DayTimeline,
  DayTimelineBucket,
  ShadowDecision,
  ShadowDecisionRecord,
} from "@charge-on-solar/shared";
import { describe, expect, it } from "vitest";
import {
  dayOverrides,
  dayPoints,
  dayShadowSwitches,
  pointAt,
} from "./day-points.ts";

const minute = 60_000;
const dayStart = Date.parse("2026-06-01T10:00:00.000Z");
const at = (minutes: number) =>
  new Date(dayStart + minutes * minute).toISOString();

function bucket(
  minutes: number,
  power: Partial<DayTimelineBucket> = {}
): DayTimelineBucket {
  return {
    start: at(minutes),
    solarProductionW: null,
    netPowerW: null,
    chargerPowerW: null,
    shadowChargerPowerW: null,
    ...power,
  };
}

/** A short stand-in for a day: three 5-minute buckets from 10:00. */
function timeline(changes: Partial<DayTimeline> = {}): DayTimeline {
  return {
    day: "2026-06-01",
    start: at(0),
    end: at(15),
    solarFetchedAt: null,
    buckets: [
      bucket(0, { netPowerW: -1000, chargerPowerW: 0, shadowChargerPowerW: 0 }),
      bucket(5, { netPowerW: -800, chargerPowerW: 0, shadowChargerPowerW: 0 }),
      bucket(10),
    ],
    shadowSwitches: [],
    overrides: [],
    ...changes,
  };
}

function decision(
  minutes: number,
  shadow: ShadowDecision,
  chargingCurrentA: number | null,
  inputs: { netPowerW: number; chargerPowerW: number } = {
    netPowerW: -1500,
    chargerPowerW: 0,
  }
): ShadowDecisionRecord {
  return {
    at: at(minutes),
    decision: shadow,
    chargingCurrentA,
    phaseSetting: 1,
    inputs: {
      surplusW: inputs.chargerPowerW - inputs.netPowerW,
      netPowerW: inputs.netPowerW,
      solarProductionW: null,
      chargerPowerW: inputs.chargerPowerW,
      fuseHeadroomA: 20,
      startWindowSurplusW: 1500,
      stopWindowSurplusW: 1500,
      dataAgeMs: { p1: 1000, charger: 20_000, solar: null },
    },
    zaptec: {
      availableCurrentMode: 0,
      enabledFeatures: null,
      surplusModeActive: false,
      chargeCurrentSetA: 16,
    },
    rulesVersion: 1,
    settings: {
      solarMode: "solar-only",
      startWindowMinutes: 5,
      stopWindowMinutes: 10,
      minimumOnTimeMinutes: 15,
      minimumOffTimeMinutes: 15,
      currentHoldMinutes: 15,
      deadBandAmps: 1,
      voltage: 230,
      mainFuseAmps: 25,
      minimumSolarWatts: 0,
      tickIntervalSeconds: 60,
    },
  };
}

const start6A: ShadowDecision = {
  kind: "start",
  currentAmps: 6,
  limitedBy: "surplus",
};
const holding: ShadowDecision = { kind: "hold", reason: "current-hold" };
const stop: ShadowDecision = { kind: "stop", reason: "surplus-too-low" };

describe("the points of a Day tab's charts", () => {
  it("are the loaded buckets up to when the day was loaded, the last one cut short there", () => {
    const points = dayPoints(timeline(), dayStart + 7 * minute, []);

    expect(points).toEqual([
      {
        start: at(0),
        end: at(5),
        solarProductionW: null,
        netPowerW: -1000,
        chargerPowerW: 0,
        shadowChargerPowerW: 0,
      },
      {
        start: at(5),
        end: at(7),
        solarProductionW: null,
        netPowerW: -800,
        chargerPowerW: 0,
        shadowChargerPowerW: 0,
      },
    ]);
  });

  it("add a point for each Shadow decision made since, from its averages and Shadow Charging current", () => {
    const points = dayPoints(timeline(), dayStart + 7 * minute, [
      decision(8, start6A, 6),
      decision(9, holding, 6, { netPowerW: 200, chargerPowerW: 1400 }),
    ]);

    expect(points.slice(2)).toEqual([
      {
        start: at(7),
        end: at(8),
        solarProductionW: null,
        netPowerW: -1500,
        chargerPowerW: 0,
        shadowChargerPowerW: 6 * 230,
      },
      {
        start: at(8),
        end: at(9),
        solarProductionW: null,
        netPowerW: 200,
        chargerPowerW: 1400,
        shadowChargerPowerW: 6 * 230,
      },
    ]);
  });

  it("leave out Shadow decisions the loaded buckets already hold, and those after the day", () => {
    const points = dayPoints(timeline(), dayStart + 7 * minute, [
      decision(6, holding, null),
      decision(16, holding, null),
    ]);

    expect(points.map((point) => point.end)).toEqual([at(5), at(7)]);
  });

  it("keep every bucket of a day that was over when it was loaded", () => {
    const points = dayPoints(timeline(), dayStart + 60 * minute, []);

    expect(points.map((point) => point.end)).toEqual([at(5), at(10), at(15)]);
  });
});

describe("the point a chart shows details of", () => {
  it("is the one the moment falls in", () => {
    const points = dayPoints(timeline(), dayStart + 7 * minute, []);

    expect(pointAt(points, dayStart + 6 * minute)?.start).toBe(at(5));
    expect(pointAt(points, dayStart + 8 * minute)).toBeUndefined();
  });
});

describe("the Shadow starts and stops of a Day tab", () => {
  it("add those of the Shadow decisions made since the day was loaded", () => {
    const switches = dayShadowSwitches(
      timeline({
        shadowSwitches: [{ at: at(2), kind: "stop", currentA: 7 }],
      }),
      dayStart + 7 * minute,
      [
        decision(6, holding, null),
        decision(8, start6A, 6),
        decision(9, holding, 8),
        decision(10, stop, null),
      ]
    );

    expect(switches).toEqual([
      { at: at(2), kind: "stop", currentA: 7 },
      { at: at(8), kind: "start", currentA: 6 },
      { at: at(10), kind: "stop", currentA: 8 },
    ]);
  });
});

describe("the Manual overrides a Day tab flags", () => {
  const sent = (id: number, minutes: number): DayOverride => ({
    id,
    command: "pause",
    status: "accepted",
    sentAt: at(minutes),
    userName: "Sam",
  });

  it("follow each override's latest step, and add those sent since", () => {
    const flags = dayOverrides(timeline({ overrides: [sent(1, 2)] }), [
      { ...sent(2, 9), command: "resume" },
      { ...sent(1, 2), status: "confirmed" },
    ]);

    expect(flags).toEqual([
      { ...sent(1, 2), status: "confirmed" },
      { ...sent(2, 9), command: "resume" },
    ]);
  });

  it("leave out the rejected ones, which changed nothing, and those of another day", () => {
    const flags = dayOverrides(
      timeline({ overrides: [{ ...sent(1, 2), status: "rejected" }] }),
      [sent(2, 20)]
    );

    expect(flags).toEqual([]);
  });
});
