import { describe, expect, it } from "vitest";
import {
  defaultShadowSettings,
  type PowerReading,
  type ShadowSnapshot,
} from "./engine.ts";
import { replayShadow } from "./replay.ts";

const morning = new Date("2026-06-01T09:00:00.000Z");

/**
 * A synthetic morning, one minute per tick: the sun comes out, a 3-minute
 * cloud passes, the Surplus climbs, then the sky stays overcast.
 * Surplus in watts per minute.
 */
const surplusByMinute = [
  ...Array(10).fill(500),
  ...Array(20).fill(2500),
  ...Array(3).fill(0),
  ...Array(30).fill(3300),
  ...Array(40).fill(200),
];

function ticks(): ShadowSnapshot[] {
  const readings: PowerReading[] = surplusByMinute.map((watts, minute) => ({
    at: new Date(morning.getTime() + minute * 60_000),
    netPowerW: -watts,
    chargerPowerW: 0,
  }));
  return readings.map((reading, minute) => ({
    at: reading.at,
    car: "connected",
    finalStopActive: false,
    phases: 1,
    chargerMaximumA: 16,
    readings: readings.slice(Math.max(0, minute - 10), minute + 1),
    phaseCurrents: { p1A: [0, 0, 0], chargerA: [0, 0, 0] },
  }));
}

describe("replaying Readings through the Shadow engine", () => {
  it("starts once, rides out the cloud, follows the Surplus, and stops once", () => {
    const decisions = replayShadow(ticks(), defaultShadowSettings);

    const changes = decisions
      .filter(({ decision }) => decision.kind !== "hold")
      .map(({ at, decision }) => ({
        minute: (at.getTime() - morning.getTime()) / 60_000,
        decision,
      }));
    // Worked out by hand from the rules: the 5-minute average first covers
    // 6 A at minute 12 (1700 W), each change waits out the 15-minute hold,
    // and the 10-minute average drops below 1380 W at minute 69.
    expect(changes).toMatchObject([
      { minute: 12, decision: { kind: "start", currentA: 7 } },
      { minute: 27, decision: { kind: "change-current", currentA: 10 } },
      { minute: 42, decision: { kind: "change-current", currentA: 14 } },
      { minute: 63, decision: { kind: "change-current", currentA: 11 } },
      { minute: 69, decision: { kind: "stop", reason: "surplus" } },
    ]);
  });

  it("starts earlier in All solar, with the same Readings", () => {
    const decisions = replayShadow(ticks(), {
      ...defaultShadowSettings,
      solarMode: "all-solar",
    });

    expect(decisions[0]?.decision).toMatchObject({
      kind: "start",
      currentA: 6,
    });
  });
});
