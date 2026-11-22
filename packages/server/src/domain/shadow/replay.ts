// The replay harness: runs recorded Readings through the Shadow engine, so a
// developer can see the decisions a day of real data would have produced.
import type { ShadowDecision, ShadowSettings } from "@charge-on-solar/shared";
import { z } from "zod";
import {
  carStates,
  decideShadow,
  noCar,
  phaseSettings,
  type SimulatedCharger,
} from "./engine.ts";

// Per-phase currents in amperes, L1 to L3.
const phaseCurrents = z.tuple([z.number(), z.number(), z.number()]);
const timestamp = z.iso.datetime().transform((iso) => new Date(iso));

const chargerReading = z.object({
  device: z.literal("charger"),
  at: timestamp,
  car: z.enum(carStates),
  phases: z.union(phaseSettings.map((phases) => z.literal(phases))),
  maximumCurrentAmps: z.number(),
  powerWatts: z.number(),
  phaseCurrentsAmps: phaseCurrents,
  finalStopPause: z.boolean(),
});

const solarReading = z.object({
  device: z.literal("solar"),
  at: timestamp,
  productionWatts: z.number(),
  phaseCurrentsAmps: phaseCurrents,
});

// Net power and per-phase currents are positive when importing.
const p1Reading = z.object({
  device: z.literal("p1"),
  at: timestamp,
  netPowerWatts: z.number(),
  phaseCurrentsAmps: phaseCurrents,
});

const reading = z.discriminatedUnion("device", [
  chargerReading,
  solarReading,
  p1Reading,
]);
export type Reading = z.infer<typeof reading>;
type ChargerReading = z.infer<typeof chargerReading>;
type SolarReading = z.infer<typeof solarReading>;
type P1Reading = z.infer<typeof p1Reading>;

const readingFixture = z.object({ readings: z.array(reading) });

/** Parses a recorded Reading fixture: `{ "readings": [...] }`. */
export function parseReadings(json: unknown): Reading[] {
  return readingFixture.parse(json).readings;
}

export interface ReplayStep {
  at: Date;
  decision: ShadowDecision;
  simulated: SimulatedCharger;
}

/**
 * Makes one Shadow decision per P1 meter Reading, from the latest charger
 * and solar Readings before it. P1 Readings before the first charger
 * Reading are skipped.
 */
export function replayReadings(
  readings: Reading[],
  settings: ShadowSettings
): ReplayStep[] {
  const ordered = [...readings].sort((a, b) => a.at.getTime() - b.at.getTime());
  const startWindow = new SurplusWindow(settings.startWindowMinutes);
  const stopWindow = new SurplusWindow(settings.stopWindowMinutes);
  let charger: ChargerReading | undefined;
  let solar: SolarReading | undefined;
  let simulated = noCar;
  const steps: ReplayStep[] = [];

  for (const next of ordered) {
    if (next.device === "charger") charger = next;
    if (next.device === "solar") solar = next;
    if (next.device !== "p1" || !charger) continue;

    const surplus = charger.powerWatts - next.netPowerWatts;
    startWindow.add(next.at, surplus);
    stopWindow.add(next.at, surplus);
    const { decision, next: after } = decideShadow(
      {
        at: next.at,
        car: charger.car,
        phases: charger.phases,
        chargerMaximumAmps: charger.maximumCurrentAmps,
        finalStopPause: charger.finalStopPause,
        startWindowSurplusWatts: startWindow.average(),
        stopWindowSurplusWatts: stopWindow.average(),
        fuseHeadroomAmps: fuseHeadroom(next, charger, solar, settings),
      },
      simulated,
      settings
    );
    simulated = after;
    steps.push({ at: next.at, decision, simulated });
  }
  return steps;
}

/** Main fuse rating minus the House consumption current on the busiest phase. */
function fuseHeadroom(
  p1: P1Reading,
  charger: ChargerReading,
  solar: SolarReading | undefined,
  settings: ShadowSettings
): number {
  const houseCurrents = p1.phaseCurrentsAmps.map(
    (net, phase) =>
      net +
      (solar?.phaseCurrentsAmps[phase] ?? 0) -
      (charger.phaseCurrentsAmps[phase] ?? 0)
  );
  return settings.mainFuseAmps - Math.max(...houseCurrents);
}

const minute = 60_000;

/** The mean Surplus over the Readings of the last few minutes. */
class SurplusWindow {
  readonly #milliseconds: number;
  readonly #surpluses: { at: number; watts: number }[] = [];
  #total = 0;

  constructor(minutes: number) {
    this.#milliseconds = minutes * minute;
  }

  add(at: Date, watts: number): void {
    this.#surpluses.push({ at: at.getTime(), watts });
    this.#total += watts;
    const oldestKept = at.getTime() - this.#milliseconds;
    while ((this.#surpluses[0]?.at ?? oldestKept) <= oldestKept) {
      this.#total -= this.#surpluses.shift()?.watts ?? 0;
    }
  }

  average(): number {
    return this.#surpluses.length === 0
      ? 0
      : this.#total / this.#surpluses.length;
  }
}

/**
 * One line per change of decision, as `HH:MM kind`, with the Charging current
 * and its limit or the reason. Times are in UTC.
 */
export function summarizeReplay(steps: ReplayStep[]): string[] {
  const lines: string[] = [];
  let previous = "";
  for (const step of steps) {
    const described = describe(step.decision);
    if (described === previous) continue;
    previous = described;
    lines.push(`${step.at.toISOString().slice(11, 16)} ${described}`);
  }
  return lines;
}

function describe(decision: ShadowDecision): string {
  switch (decision.kind) {
    case "start":
    case "change-current":
      return `${decision.kind} ${decision.currentAmps} A (${decision.limitedBy})`;
    case "stop":
    case "hold":
      return `${decision.kind} (${decision.reason})`;
    case "paused":
      return `paused, would ${describe(decision.underlying)}`;
    case "no-car":
    case "car-not-accepting":
      return decision.kind;
  }
}
