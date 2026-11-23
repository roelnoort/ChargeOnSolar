import {
  type ChargerReading,
  chargerOperationModes,
} from "./charger-reading.ts";

/** How many interruptions the charger allows in one charge session. */
export const switchesPerChargeSession = 20;

const { disconnected, charging } = chargerOperationModes;

/**
 * Interruptions seen in the real charger state since the car was plugged in:
 * charging stopping while the car stays connected, whoever stopped it, and
 * every change of phases. Null while no car is connected.
 */
export function countInterruptions(
  count: number | null,
  previous: ChargerReading | undefined,
  reading: ChargerReading
): number | null {
  if (reading.operationMode === disconnected) return null;
  if (reading.operationMode === null) return count;
  const sessionCount = count ?? 0;
  if (!previous || previous.operationMode === disconnected) return sessionCount;
  const stopped =
    previous.operationMode === charging && reading.operationMode !== charging;
  const phasesSwitched =
    previous.phaseSetting !== null &&
    reading.phaseSetting !== null &&
    previous.phaseSetting !== reading.phaseSetting;
  return sessionCount + (stopped ? 1 : 0) + (phasesSwitched ? 1 : 0);
}
