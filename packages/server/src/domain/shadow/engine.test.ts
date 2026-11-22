import { describe, expect, it } from "vitest";
import {
  decideShadow,
  defaultShadowSettings,
  initialSimulatedCharger,
  isCharging,
  type PowerReading,
  type ShadowSnapshot,
  type SimulatedCharger,
  shadowRulesVersion,
} from "./engine.ts";

const noon = new Date("2026-06-01T12:00:00.000Z");

function minutesAfter(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * 60_000);
}

/** One Reading every 10 s over the given minutes before `at`, at a steady Surplus. */
function surplusOf(
  watts: number,
  { at = noon, minutes = 10 }: { at?: Date; minutes?: number } = {}
): PowerReading[] {
  const readings: PowerReading[] = [];
  for (let s = minutes * 60 - 10; s >= 0; s -= 10) {
    readings.push({
      at: new Date(at.getTime() - s * 1000),
      netPowerW: -watts,
      chargerPowerW: 0,
    });
  }
  return readings;
}

function snapshot(overrides: Partial<ShadowSnapshot> = {}): ShadowSnapshot {
  return {
    at: noon,
    car: "connected",
    finalStopActive: false,
    phases: 1,
    chargerMaximumA: 32,
    readings: [],
    phaseCurrents: { p1A: [0, 0, 0], chargerA: [0, 0, 0] },
    ...overrides,
  };
}

function chargingFor(minutes: number, currentA = 10): SimulatedCharger {
  const since = minutesAfter(noon, -minutes);
  return {
    carConnected: true,
    currentA,
    currentChangedAt: since,
    startedAt: since,
    stoppedAt: null,
    simulatedSwitches: 1,
  };
}

function stoppedFor(minutes: number, simulatedSwitches = 2): SimulatedCharger {
  return {
    carConnected: true,
    currentA: null,
    currentChangedAt: null,
    startedAt: minutesAfter(noon, -minutes - 20),
    stoppedAt: minutesAfter(noon, -minutes),
    simulatedSwitches,
  };
}

describe("Shadow engine", () => {
  it("decides No car when no car is connected", () => {
    const { decision } = decideShadow(
      snapshot({ car: "no-car" }),
      initialSimulatedCharger,
      defaultShadowSettings
    );

    expect(decision).toEqual({ kind: "no-car" });
  });

  describe("in Solar only", () => {
    it.each([
      { surplusW: 1380, phases: 1, kind: "start" },
      { surplusW: 1379, phases: 1, kind: "hold" },
      { surplusW: 4140, phases: 3, kind: "start" },
      { surplusW: 4139, phases: 3, kind: "hold" },
    ] as const)(
      "$kind at $surplusW W of Surplus on $phases phase(s)",
      ({ surplusW, phases, kind }) => {
        const { decision } = decideShadow(
          snapshot({ phases, readings: surplusOf(surplusW) }),
          initialSimulatedCharger,
          defaultShadowSettings
        );

        expect(decision.kind).toBe(kind);
      }
    );

    it("starts at the Charging current the 5-minute average Surplus covers", () => {
      const { decision, next } = decideShadow(
        snapshot({ readings: surplusOf(3300) }),
        initialSimulatedCharger,
        defaultShadowSettings
      );

      expect(decision).toMatchObject({
        kind: "start",
        currentA: 14,
        limitedBy: "surplus",
      });
      expect(next).toMatchObject({ currentA: 14, simulatedSwitches: 1 });
    });

    it("averages Surplus over the start window only", () => {
      const readings = [
        ...surplusOf(0, { at: minutesAfter(noon, -5), minutes: 5 }),
        ...surplusOf(1380, { minutes: 5 }),
      ];

      const { decision } = decideShadow(
        snapshot({ readings }),
        initialSimulatedCharger,
        defaultShadowSettings
      );

      expect(decision.kind).toBe("start");
    });
  });

  describe("Charging current", () => {
    it.each([
      {
        name: "the charger maximum",
        chargerMaximumA: 16,
        phaseCurrents: { p1A: [0, 0, 0], chargerA: [0, 0, 0] },
        currentA: 16,
        limitedBy: "charger-maximum",
      },
      {
        name: "Fuse headroom on the busiest phase",
        chargerMaximumA: 32,
        phaseCurrents: { p1A: [3, 15.5, 2], chargerA: [0, 0, 0] },
        currentA: 9,
        limitedBy: "fuse-headroom",
      },
      {
        name: "Fuse headroom, not counting the charger's own current",
        chargerMaximumA: 32,
        phaseCurrents: { p1A: [20, 0, 0], chargerA: [10, 0, 0] },
        currentA: 15,
        limitedBy: "fuse-headroom",
      },
    ] as const)(
      "is clamped to $name",
      ({ chargerMaximumA, phaseCurrents, currentA, limitedBy }) => {
        const { decision } = decideShadow(
          snapshot({
            chargerMaximumA,
            phaseCurrents,
            readings: surplusOf(10_000),
          }),
          initialSimulatedCharger,
          defaultShadowSettings
        );

        expect(decision).toMatchObject({ kind: "start", currentA, limitedBy });
      }
    );

    it("does not start when Fuse headroom is below 6 A", () => {
      const { decision, next } = decideShadow(
        snapshot({
          phaseCurrents: { p1A: [19.5, 0, 0], chargerA: [0, 0, 0] },
          readings: surplusOf(10_000),
        }),
        initialSimulatedCharger,
        defaultShadowSettings
      );

      expect(decision).toMatchObject({
        kind: "hold",
        currentA: null,
        heldBy: "fuse-headroom",
      });
      expect(isCharging(next)).toBe(false);
    });
  });

  describe("stopping in Solar only", () => {
    it("stops when the 10-minute average Surplus falls below 6 A worth", () => {
      const { decision, next } = decideShadow(
        snapshot({ readings: surplusOf(1379) }),
        chargingFor(15),
        defaultShadowSettings
      );

      expect(decision).toMatchObject({ kind: "stop", reason: "surplus" });
      expect(next).toMatchObject({
        currentA: null,
        stoppedAt: noon,
        simulatedSwitches: 2,
      });
    });

    it("keeps charging through a short cloud", () => {
      const readings = [
        ...surplusOf(2000, { at: minutesAfter(noon, -2), minutes: 8 }),
        ...surplusOf(0, { minutes: 2 }),
      ];

      const { decision, next } = decideShadow(
        snapshot({ readings }),
        chargingFor(30),
        defaultShadowSettings
      );

      expect(decision).toMatchObject({ kind: "change-current", currentA: 6 });
      expect(isCharging(next)).toBe(true);
    });

    it("holds until the minimum on-time has passed", () => {
      const { decision, next } = decideShadow(
        snapshot({ readings: surplusOf(0) }),
        chargingFor(14),
        defaultShadowSettings
      );

      expect(decision).toMatchObject({
        kind: "hold",
        currentA: 10,
        heldBy: "minimum-on-time",
      });
      expect(isCharging(next)).toBe(true);
    });

    it("stops at once when Fuse headroom drops below 6 A", () => {
      const { decision } = decideShadow(
        snapshot({
          readings: surplusOf(5000),
          phaseCurrents: { p1A: [29.5, 0, 0], chargerA: [10, 0, 0] },
        }),
        chargingFor(1),
        defaultShadowSettings
      );

      expect(decision).toMatchObject({ kind: "stop", reason: "fuse-headroom" });
    });
  });

  describe("changing the Charging current", () => {
    it("follows the 5-minute average Surplus once the hold has passed", () => {
      const { decision, next } = decideShadow(
        snapshot({ readings: surplusOf(3300) }),
        chargingFor(15, 10),
        defaultShadowSettings
      );

      expect(decision).toMatchObject({
        kind: "change-current",
        currentA: 14,
        limitedBy: "surplus",
      });
      expect(next).toMatchObject({
        currentA: 14,
        currentChangedAt: noon,
        simulatedSwitches: 1,
      });
    });

    it("holds the current for 15 minutes after it last changed", () => {
      const previous = {
        ...chargingFor(30, 10),
        currentChangedAt: minutesAfter(noon, -14),
      };

      const { decision, next } = decideShadow(
        snapshot({ readings: surplusOf(3300) }),
        previous,
        defaultShadowSettings
      );

      expect(decision).toMatchObject({
        kind: "hold",
        currentA: 10,
        heldBy: "current-hold",
      });
      expect(next).toEqual(previous);
    });

    it("ignores a difference smaller than the dead band", () => {
      const { decision } = decideShadow(
        snapshot({ readings: surplusOf(2530) }),
        chargingFor(30, 10),
        { ...defaultShadowSettings, deadBandA: 2 }
      );

      expect(decision).toMatchObject({
        kind: "hold",
        currentA: 10,
        heldBy: "dead-band",
      });
    });

    it("holds without a reason when the current is already right", () => {
      const { decision } = decideShadow(
        snapshot({ readings: surplusOf(2300) }),
        chargingFor(30, 10),
        defaultShadowSettings
      );

      expect(decision).toMatchObject({
        kind: "hold",
        currentA: 10,
        heldBy: null,
      });
    });
  });

  describe("starting again", () => {
    it.each([
      { stoppedMin: 14, kind: "hold", heldBy: "minimum-off-time" },
      { stoppedMin: 15, kind: "start", heldBy: undefined },
    ] as const)(
      "$kind after $stoppedMin minutes stopped",
      ({ stoppedMin, kind, heldBy }) => {
        const { decision } = decideShadow(
          snapshot({ readings: surplusOf(3000) }),
          stoppedFor(stoppedMin),
          defaultShadowSettings
        );

        expect(decision.kind).toBe(kind);
        if (heldBy) expect(decision).toMatchObject({ heldBy });
      }
    );

    it.each([
      { simulatedSwitches: 18, kind: "start" },
      { simulatedSwitches: 19, kind: "hold" },
    ] as const)(
      "$kind with $simulatedSwitches simulated switches used, keeping 2 in reserve",
      ({ simulatedSwitches, kind }) => {
        const { decision } = decideShadow(
          snapshot({ readings: surplusOf(3000) }),
          stoppedFor(60, simulatedSwitches),
          defaultShadowSettings
        );

        expect(decision.kind).toBe(kind);
        if (kind === "hold") {
          expect(decision).toMatchObject({ heldBy: "switch-budget" });
        }
      }
    );
  });

  describe("the charge session", () => {
    it("resets at plug-in, so the first start skips the minimum off-time", () => {
      const lastSession = {
        ...stoppedFor(1, 19),
        carConnected: false,
      };

      const { decision, next } = decideShadow(
        snapshot({ readings: surplusOf(3000) }),
        lastSession,
        defaultShadowSettings
      );

      expect(decision.kind).toBe("start");
      expect(next).toMatchObject({ carConnected: true, simulatedSwitches: 1 });
    });

    it("remembers the car is plugged in while waiting for Surplus", () => {
      const { next } = decideShadow(
        snapshot({ readings: surplusOf(0) }),
        initialSimulatedCharger,
        defaultShadowSettings
      );

      expect(next).toEqual({ ...initialSimulatedCharger, carConnected: true });
    });

    it("ends at unplug", () => {
      const { decision, next } = decideShadow(
        snapshot({ car: "no-car", readings: surplusOf(3000) }),
        chargingFor(30),
        defaultShadowSettings
      );

      expect(decision).toEqual({ kind: "no-car" });
      expect(next).toEqual(initialSimulatedCharger);
    });
  });

  describe("in All solar", () => {
    const allSolar = {
      ...defaultShadowSettings,
      solarMode: "all-solar",
    } as const;

    it.each([
      { surplusW: 1, minimumSolarW: 0, kind: "start" },
      { surplusW: 0, minimumSolarW: 0, kind: "hold" },
      { surplusW: 501, minimumSolarW: 500, kind: "start" },
      { surplusW: 500, minimumSolarW: 500, kind: "hold" },
    ] as const)(
      "$kind at $surplusW W of Surplus with minimum solar $minimumSolarW W",
      ({ surplusW, minimumSolarW, kind }) => {
        const { decision } = decideShadow(
          snapshot({ readings: surplusOf(surplusW) }),
          initialSimulatedCharger,
          { ...allSolar, minimumSolarW }
        );

        expect(decision.kind).toBe(kind);
      }
    );

    it("starts at 6 A even when the Surplus covers less", () => {
      const { decision } = decideShadow(
        snapshot({ readings: surplusOf(400) }),
        initialSimulatedCharger,
        allSolar
      );

      expect(decision).toMatchObject({ kind: "start", currentA: 6 });
    });

    it.each([
      { surplusW: 0, kind: "stop" },
      { surplusW: 1, kind: "hold" },
    ] as const)(
      "$kind while charging at $surplusW W of Surplus",
      ({ surplusW, kind }) => {
        const { decision } = decideShadow(
          snapshot({ readings: surplusOf(surplusW) }),
          chargingFor(30, 6),
          allSolar
        );

        expect(decision.kind).toBe(kind);
      }
    );
  });

  describe("states that override the decision", () => {
    it("counts Car not accepting charge as stopped, without a switch", () => {
      const { decision, next } = decideShadow(
        snapshot({ car: "not-accepting", readings: surplusOf(3000) }),
        chargingFor(30),
        defaultShadowSettings
      );

      expect(decision).toEqual({ kind: "car-not-accepting" });
      expect(next).toMatchObject({
        carConnected: true,
        currentA: null,
        simulatedSwitches: 1,
      });
    });

    it("shows Paused by you over the decision it would otherwise make", () => {
      const { decision, next } = decideShadow(
        snapshot({ finalStopActive: true, readings: surplusOf(3300) }),
        initialSimulatedCharger,
        defaultShadowSettings
      );

      expect(decision).toMatchObject({
        kind: "paused-by-you",
        underlying: { kind: "start", currentA: 14 },
      });
      expect(next).toMatchObject({ currentA: 14 });
    });
  });

  describe("what each decision is stamped with", () => {
    it.each([
      { name: "a start", car: "connected" },
      { name: "No car", car: "no-car" },
      { name: "Car not accepting charge", car: "not-accepting" },
    ] as const)(
      "stamps $name with its inputs, settings and rules version",
      ({ car }) => {
        const settings = { ...defaultShadowSettings, mainFuseA: 20 };

        const outcome = decideShadow(
          snapshot({
            car,
            readings: [
              ...surplusOf(0, { at: minutesAfter(noon, -5), minutes: 5 }),
              ...surplusOf(3000, { minutes: 5 }),
            ],
            phaseCurrents: { p1A: [4, 8, 2], chargerA: [0, 2, 0] },
          }),
          initialSimulatedCharger,
          settings
        );

        expect(outcome).toMatchObject({
          inputs: {
            startAverageW: 3000,
            stopAverageW: 1500,
            fuseHeadroomA: 14,
          },
          settings,
          rulesVersion: shadowRulesVersion,
        });
      }
    );

    it("stamps no averages when there are no Readings", () => {
      const { inputs } = decideShadow(
        snapshot(),
        initialSimulatedCharger,
        defaultShadowSettings
      );

      expect(inputs).toMatchObject({ startAverageW: null, stopAverageW: null });
    });
  });

  describe("without Readings", () => {
    it.each([
      { name: "stopped", previous: initialSimulatedCharger, currentA: null },
      { name: "charging", previous: chargingFor(30, 10), currentA: 10 },
    ])("holds while $name", ({ previous, currentA }) => {
      const stale = surplusOf(3000, { at: minutesAfter(noon, -20) });

      const { decision, next } = decideShadow(
        snapshot({ readings: stale }),
        previous,
        defaultShadowSettings
      );

      expect(decision).toMatchObject({
        kind: "hold",
        currentA,
        heldBy: "no-readings",
      });
      expect(next.currentA).toBe(currentA);
    });
  });
});
