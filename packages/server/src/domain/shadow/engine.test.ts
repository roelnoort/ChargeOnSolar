import { describe, expect, it } from "vitest";
import {
  decideShadow,
  defaultShadowSettings,
  noCar,
  type ShadowSettings,
  type ShadowSnapshot,
  type SimulatedCharger,
  shadowRulesVersion,
  stampShadowSettings,
} from "./engine.ts";

const minute = 60_000;
const t0 = new Date("2026-06-01T09:00:00.000Z");
const at = (minutes: number) => new Date(t0.getTime() + minutes * minute);

// The watts that 6 A carries at 230 V: 1380 W on 1 phase, 4140 W on 3.
const sixAmpWatts = { 1: 1380, 3: 4140 } as const;

function snapshot(overrides: Partial<ShadowSnapshot> = {}): ShadowSnapshot {
  return {
    at: at(0),
    car: "accepting",
    phases: 1,
    chargerMaximumAmps: 16,
    finalStopPause: false,
    startWindowSurplusWatts: 0,
    stopWindowSurplusWatts: 0,
    fuseHeadroomAmps: 20,
    ...overrides,
  };
}

/** A car that has been plugged in, and stopped, since long before t0. */
function stopped(overrides: Partial<SimulatedCharger> = {}): SimulatedCharger {
  return {
    carConnected: true,
    charging: false,
    currentAmps: null,
    currentChangedAt: null,
    switchedAt: at(-60),
    switchCount: 1,
    ...overrides,
  };
}

/** Charging at 10 A since long before t0. */
function charging(overrides: Partial<SimulatedCharger> = {}): SimulatedCharger {
  return {
    carConnected: true,
    charging: true,
    currentAmps: 10,
    currentChangedAt: at(-60),
    switchedAt: at(-60),
    switchCount: 2,
    ...overrides,
  };
}

function settings(overrides: Partial<ShadowSettings> = {}): ShadowSettings {
  return { ...defaultShadowSettings, ...overrides };
}

const solarOnly = settings({ solarMode: "solar-only" });
const allSolar = settings({ solarMode: "all-solar", minimumSolarWatts: 300 });

describe.each([1, 3] as const)("on %i phase(s)", (phases) => {
  const sixAmps = sixAmpWatts[phases];

  describe("start", () => {
    it.each([
      ["Solar only", sixAmps, "start", solarOnly],
      ["Solar only", sixAmps - 1, "hold", solarOnly],
      ["All solar", 301, "start", allSolar],
      ["All solar", 300, "hold", allSolar],
    ] as const)(
      "%s with %i W of start-window Surplus: %s",
      (_mode, surplus, kind, rules) => {
        const { decision } = decideShadow(
          snapshot({ phases, startWindowSurplusWatts: surplus }),
          stopped(),
          rules
        );

        expect(decision.kind).toBe(kind);
        if (decision.kind === "hold")
          expect(decision.reason).toBe("surplus-too-low");
      }
    );

    describe.each([
      ["Solar only", solarOnly],
      ["All solar", allSolar],
    ] as const)("in %s", (_mode, rules) => {
      const plenty = snapshot({
        phases,
        startWindowSurplusWatts: sixAmps * 2,
      });

      it("holds until the minimum off-time has passed since the last stop", () => {
        const justStopped = stopped({ switchedAt: at(-14) });
        const longStopped = stopped({ switchedAt: at(-15) });

        expect(decideShadow(plenty, justStopped, rules).decision).toEqual({
          kind: "hold",
          reason: "minimum-off-time",
        });
        expect(decideShadow(plenty, longStopped, rules).decision.kind).toBe(
          "start"
        );
      });

      it("starts at once on the first start after plug-in", () => {
        const { decision } = decideShadow(plenty, noCar, rules);

        expect(decision.kind).toBe("start");
      });

      it("holds when fewer than 2 simulated switches are left", () => {
        expect(
          decideShadow(plenty, stopped({ switchCount: 19 }), rules).decision
        ).toEqual({ kind: "hold", reason: "switch-budget" });
        expect(
          decideShadow(plenty, stopped({ switchCount: 18 }), rules).decision
            .kind
        ).toBe("start");
      });

      it("records the start in the simulated charger and counts a switch", () => {
        const { decision, next } = decideShadow(
          plenty,
          stopped({ switchCount: 3 }),
          rules
        );

        expect(decision).toEqual({
          kind: "start",
          currentAmps: 12,
          limitedBy: "surplus",
        });
        expect(next).toEqual({
          carConnected: true,
          charging: true,
          currentAmps: 12,
          currentChangedAt: at(0),
          switchedAt: at(0),
          switchCount: 4,
        });
      });
    });

    describe("Charging current", () => {
      const perAmp = 230 * phases;

      it.each([
        // [start-window Surplus in amps' worth, charger max, Fuse headroom, current, limit]
        [9.9, 16, 20, 9, "surplus"],
        [20, 16, 20, 16, "charger-maximum"],
        [20, 16, 11.5, 11, "fuse-headroom"],
        [20, 16, 6, 6, "fuse-headroom"],
      ] as const)(
        "%f A worth of Surplus, %i A charger maximum, %f A Fuse headroom: %i A, set by %s",
        (surplusAmps, chargerMaximumAmps, fuseHeadroomAmps, currentAmps, limitedBy) => {
          const { decision } = decideShadow(
            snapshot({
              phases,
              startWindowSurplusWatts: surplusAmps * perAmp,
              chargerMaximumAmps,
              fuseHeadroomAmps,
            }),
            stopped(),
            solarOnly
          );

          expect(decision).toEqual({ kind: "start", currentAmps, limitedBy });
        }
      );

      it("starts All solar at the 6 A minimum when the Surplus is below it", () => {
        const { decision } = decideShadow(
          snapshot({ phases, startWindowSurplusWatts: 2 * perAmp }),
          stopped(),
          allSolar
        );

        expect(decision).toEqual({
          kind: "start",
          currentAmps: 6,
          limitedBy: "minimum-current",
        });
      });

      it.each([
        ["Solar only", solarOnly],
        ["All solar", allSolar],
      ] as const)(
        "holds in %s while Fuse headroom is below 6 A",
        (_mode, rules) => {
          const { decision } = decideShadow(
            snapshot({
              phases,
              startWindowSurplusWatts: 10 * perAmp,
              fuseHeadroomAmps: 5.9,
            }),
            stopped(),
            rules
          );

          expect(decision).toEqual({ kind: "hold", reason: "fuse-headroom" });
        }
      );
    });

    describe("stop", () => {
      // The start window still shows plenty, so only the stop window decides.
      const withStopWindow = (stopWindowSurplusWatts: number) =>
        snapshot({
          phases,
          startWindowSurplusWatts: 10 * 230 * phases,
          stopWindowSurplusWatts,
        });

      it.each([
        ["Solar only", sixAmps - 1, "stop", solarOnly],
        ["Solar only", sixAmps, "hold", solarOnly],
        ["All solar", 300, "stop", allSolar],
        ["All solar", 301, "hold", allSolar],
      ] as const)(
        "%s with %i W of stop-window Surplus: %s",
        (_mode, surplus, kind, rules) => {
          const { decision } = decideShadow(
            withStopWindow(surplus),
            charging({ currentAmps: 10 }),
            rules
          );

          expect(decision.kind).toBe(kind);
          if (decision.kind === "stop")
            expect(decision.reason).toBe("surplus-too-low");
        }
      );

      describe.each([
        ["Solar only", solarOnly],
        ["All solar", allSolar],
      ] as const)("in %s", (_mode, rules) => {
        it("holds until the minimum on-time has passed since the start", () => {
          const low = withStopWindow(0);

          expect(
            decideShadow(low, charging({ switchedAt: at(-14) }), rules).decision
          ).toEqual({ kind: "hold", reason: "minimum-on-time" });
          expect(
            decideShadow(low, charging({ switchedAt: at(-15) }), rules).decision
              .kind
          ).toBe("stop");
        });

        it("stops at once when Fuse headroom drops below 6 A", () => {
          const { decision } = decideShadow(
            snapshot({
              phases,
              startWindowSurplusWatts: 10 * 230 * phases,
              stopWindowSurplusWatts: 10 * 230 * phases,
              fuseHeadroomAmps: 5.9,
            }),
            charging({ switchedAt: at(-1) }),
            rules
          );

          expect(decision).toEqual({ kind: "stop", reason: "fuse-headroom" });
        });

        it("records the stop in the simulated charger and counts a switch", () => {
          const { next } = decideShadow(
            withStopWindow(0),
            charging({ switchCount: 5 }),
            rules
          );

          expect(next).toEqual({
            carConnected: true,
            charging: false,
            currentAmps: null,
            currentChangedAt: at(-60),
            switchedAt: at(0),
            switchCount: 6,
          });
        });
      });
    });

    describe("change current", () => {
      const perAmp = 230 * phases;
      const surplusOf = (
        amps: number,
        overrides: Partial<ShadowSnapshot> = {}
      ) =>
        snapshot({
          phases,
          startWindowSurplusWatts: amps * perAmp,
          stopWindowSurplusWatts: amps * perAmp,
          ...overrides,
        });

      describe.each([
        ["Solar only", solarOnly],
        ["All solar", allSolar],
      ] as const)("in %s", (_mode, rules) => {
        it("changes to the new Charging current once the current hold has passed", () => {
          const { decision, next } = decideShadow(
            surplusOf(12.5),
            charging({ currentAmps: 10, currentChangedAt: at(-15) }),
            rules
          );

          expect(decision).toEqual({
            kind: "change-current",
            currentAmps: 12,
            limitedBy: "surplus",
          });
          expect(next).toMatchObject({
            charging: true,
            currentAmps: 12,
            currentChangedAt: at(0),
            switchedAt: at(-60),
            switchCount: 2,
          });
        });

        it("holds the Charging current until the current hold has passed", () => {
          const previous = charging({
            currentAmps: 10,
            currentChangedAt: at(-14),
          });
          const { decision, next } = decideShadow(
            surplusOf(12),
            previous,
            rules
          );

          expect(decision).toEqual({ kind: "hold", reason: "current-hold" });
          expect(next).toEqual(previous);
        });

        it.each([
          [10.9, "hold"],
          [11, "change-current"],
          [9, "change-current"],
        ] as const)(
          "from 10 A with %f A worth of Surplus: %s",
          (amps, kind) => {
            const { decision } = decideShadow(
              surplusOf(amps),
              charging({ currentAmps: 10 }),
              rules
            );

            expect(decision.kind).toBe(kind);
            if (decision.kind === "hold") {
              expect(decision.reason).toBe("within-dead-band");
            }
          }
        );

        it("records when Fuse headroom set the new Charging current", () => {
          const { decision } = decideShadow(
            surplusOf(14, { fuseHeadroomAmps: 8.2 }),
            charging({ currentAmps: 10 }),
            rules
          );

          expect(decision).toEqual({
            kind: "change-current",
            currentAmps: 8,
            limitedBy: "fuse-headroom",
          });
        });

        it("lowers the Charging current to Fuse headroom at once, inside the current hold", () => {
          const { decision } = decideShadow(
            surplusOf(14, { fuseHeadroomAmps: 9.5 }),
            charging({ currentAmps: 10, currentChangedAt: at(-1) }),
            rules
          );

          expect(decision).toEqual({
            kind: "change-current",
            currentAmps: 9,
            limitedBy: "fuse-headroom",
          });
        });

        it("lowers the Charging current to Fuse headroom at once, inside the minimum on-time", () => {
          const { decision } = decideShadow(
            surplusOf(14, { stopWindowSurplusWatts: 0, fuseHeadroomAmps: 7 }),
            charging({
              currentAmps: 10,
              currentChangedAt: at(-1),
              switchedAt: at(-1),
            }),
            rules
          );

          expect(decision).toEqual({
            kind: "change-current",
            currentAmps: 7,
            limitedBy: "fuse-headroom",
          });
        });

        it("still stops for too little Surplus, after the minimum on-time, above Fuse headroom", () => {
          const { decision } = decideShadow(
            surplusOf(14, { stopWindowSurplusWatts: 0, fuseHeadroomAmps: 7 }),
            charging({ currentAmps: 10 }),
            rules
          );

          expect(decision).toEqual({ kind: "stop", reason: "surplus-too-low" });
        });
      });

      it("drops All solar to the 6 A minimum when the Surplus no longer covers it", () => {
        const { decision } = decideShadow(
          surplusOf(2),
          charging({ currentAmps: 10 }),
          allSolar
        );

        expect(decision).toEqual({
          kind: "change-current",
          currentAmps: 6,
          limitedBy: "minimum-current",
        });
      });
    });

    describe("car and pause", () => {
      const plenty = (overrides: Partial<ShadowSnapshot> = {}) =>
        snapshot({
          phases,
          startWindowSurplusWatts: 10 * 230 * phases,
          stopWindowSurplusWatts: 10 * 230 * phases,
          ...overrides,
        });

      describe.each([
        ["Solar only", solarOnly],
        ["All solar", allSolar],
      ] as const)("in %s", (_mode, rules) => {
        it("reports No car and ends the charge session when the car is unplugged", () => {
          const { decision, next } = decideShadow(
            plenty({ car: "none" }),
            charging(),
            rules
          );

          expect(decision).toEqual({ kind: "no-car" });
          expect(next).toEqual(noCar);
        });

        it("starts a fresh charge session, with a full Switch budget, at plug-in", () => {
          const unpluggedAfterManySwitches = { ...noCar, switchCount: 19 };
          const { decision, next } = decideShadow(
            plenty(),
            unpluggedAfterManySwitches,
            rules
          );

          expect(decision.kind).toBe("start");
          expect(next.switchCount).toBe(1);
        });

        it("counts a car that is not accepting charge as stopped, without a switch", () => {
          const { decision, next } = decideShadow(
            plenty({ car: "not-accepting" }),
            charging({ switchCount: 4 }),
            rules
          );

          expect(decision).toEqual({ kind: "car-not-accepting" });
          expect(next).toMatchObject({
            charging: false,
            currentAmps: null,
            switchedAt: at(0),
            switchCount: 4,
          });
        });

        it("reports Paused by you during a final-stop pause, with the decision it would have made", () => {
          const { decision } = decideShadow(
            plenty({ finalStopPause: true }),
            stopped(),
            rules
          );

          expect(decision).toEqual({
            kind: "paused",
            underlying: {
              kind: "start",
              currentAmps: 10,
              limitedBy: "surplus",
            },
          });
        });

        it("keeps the simulated charger stopped, without a switch, during a final-stop pause", () => {
          const { next } = decideShadow(
            plenty({ finalStopPause: true }),
            charging({ switchCount: 4 }),
            rules
          );

          expect(next).toMatchObject({
            charging: false,
            switchedAt: at(0),
            switchCount: 4,
          });
        });

        it("lets a final-stop pause win over a car that is not accepting charge", () => {
          const { decision } = decideShadow(
            plenty({ finalStopPause: true, car: "not-accepting" }),
            stopped(),
            rules
          );

          expect(decision).toEqual({
            kind: "paused",
            underlying: { kind: "car-not-accepting" },
          });
        });
      });
    });
  });
});

describe("settings", () => {
  it("defaults to the values the spec gives", () => {
    expect(defaultShadowSettings).toEqual({
      startWindowMinutes: 5,
      stopWindowMinutes: 10,
      minimumOnTimeMinutes: 15,
      minimumOffTimeMinutes: 15,
      currentHoldMinutes: 15,
      deadBandAmps: 1,
      voltage: 230,
      mainFuseAmps: 25,
      minimumSolarWatts: 0,
      solarMode: "solar-only",
    });
  });

  it("stamps the settings with the rules version", () => {
    const changed = settings({ deadBandAmps: 2 });

    expect(stampShadowSettings(changed)).toEqual({
      rulesVersion: shadowRulesVersion,
      settings: changed,
    });
  });
});
