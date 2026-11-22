import type { PhaseSetting } from "@charge-on-solar/shared";
import type { P1PhaseName } from "./p1-reading.ts";

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
