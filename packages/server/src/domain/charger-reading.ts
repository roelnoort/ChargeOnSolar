import {
  type ChargerState,
  type P1PhaseName,
  type PhaseSetting,
  phaseSetting,
} from "@charge-on-solar/shared";

/** Zaptec's ChargerOperationMode (state 710). */
export const chargerOperationModes = {
  disconnected: 1,
  connected: 2,
  charging: 3,
  stopped: 5,
} as const;

/** A Reading of the charger and its installation, from the Zaptec cloud. */
export interface ChargerReading {
  /** When the server received it. */
  receivedAt: Date;
  /** Charger power in watts. Null when Zaptec leaves it out. */
  chargerPowerW: number | null;
  /** The Charging current Zaptec has set, in amperes. */
  chargingCurrentSetA: number | null;
  /** Zaptec's ChargerOperationMode (state 710). */
  operationMode: number | null;
  /** Zaptec's FinalStopActive (state 718): paused, or stopped by a schedule. */
  finalStopActive: boolean;
  /** Zaptec's NextScheduleEvent (state 763), as it sent it. */
  nextScheduleEvent: string | null;
  /** The Phase setting: Zaptec's MaxPhases. */
  phaseSetting: PhaseSetting | null;
  /** The charger's maximum current, in amperes. */
  maxCurrentA: number | null;
  /** The current the charger draws on each phase, in amperes. */
  phaseCurrentsA: Record<P1PhaseName, number | null>;
  /** The installation's `availableCurrentMode`: 0 Default, 1 Scheduled, 2 APM. */
  availableCurrentMode: number | null;
  /** The installation's `enabledFeatures` bitmask. */
  enabledFeatures: number | null;
  /** Whether Zaptec's own Surplus mode is active. */
  surplusModeActive: boolean | null;
  /** The charger state and installation exactly as Zaptec sent them, as JSON. */
  rawState: string;
}

/** The Phase setting for Zaptec's MaxPhases; null for anything but 1 or 3. */
export function toPhaseSetting(maxPhases: number | null): PhaseSetting | null {
  const parsed = phaseSetting.safeParse(maxPhases);
  return parsed.success ? parsed.data : null;
}

// Zaptec's ChargerOperationMode (state 710) and FinalStopActive (state 718).
export function toChargerState({
  operationMode,
  finalStopActive,
}: ChargerReading): ChargerState {
  switch (operationMode) {
    case 1:
      return "disconnected";
    case 2:
      return "connected";
    case 3:
      return "charging";
    case 5:
      return finalStopActive ? "paused" : "finished";
    default:
      return "unknown";
  }
}
