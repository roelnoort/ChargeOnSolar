import {
  type P1PhaseName,
  type PhaseSetting,
  p1Phases,
} from "@charge-on-solar/shared";
import type { ChargerReading } from "./charger-reading.ts";
import type { P1Reading } from "./p1-reading.ts";
import type { SolarInterval } from "./solar-interval.ts";

/** Surplus in watts: Charger power minus Net power, totalled over all phases. */
export function surplusW(
  p1: P1Reading | undefined,
  charger: ChargerReading | undefined
): number | null {
  if (!p1 || charger?.chargerPowerW == null) return null;
  return charger.chargerPowerW - p1.netPowerW;
}

// A Go 2 on 1 phase switches to L1.
const phasesInUse: Record<PhaseSetting, readonly P1PhaseName[]> = {
  1: ["l1"],
  3: p1Phases,
};

/**
 * Fuse headroom in amperes: the main fuse rating minus the House consumption
 * current on the busiest phase the charger uses. Null when no such phase has
 * a current from both the P1 meter and the charger.
 */
export function fuseHeadroomA(
  p1: P1Reading | undefined,
  charger: ChargerReading | undefined,
  mainFuseA: number
): number | null {
  if (!p1 || !charger) return null;
  const houseCurrents = phasesInUse[charger.phaseSetting ?? 3].flatMap(
    (phase) => {
      const meter = p1.phases[phase];
      const chargerCurrent = charger.phaseCurrentsA[phase];
      if (meter.currentA === null || chargerCurrent === null) return [];
      // The P1 meter reports current without a sign; its power has the sign.
      const gridCurrent =
        (meter.powerW ?? 0) < 0 ? -meter.currentA : meter.currentA;
      return [gridCurrent - chargerCurrent];
    }
  );
  if (houseCurrents.length === 0) return null;
  return mainFuseA - Math.max(...houseCurrents);
}

/**
 * House consumption in watts: Net power plus Solar production minus Charger
 * power. Null without all three. The Solar production is Enphase's latest
 * 5-minute average, so this is for display only.
 */
export function houseConsumptionW(
  p1: P1Reading | undefined,
  solar: SolarInterval | undefined,
  charger: ChargerReading | undefined
): number | null {
  if (!p1 || !solar || charger?.chargerPowerW == null) return null;
  return p1.netPowerW + solar.solarProductionW - charger.chargerPowerW;
}
