import type { ChargerReading } from "./charger-reading.ts";
import type { P1Reading } from "./p1-reading.ts";
import { countInterruptions } from "./switch-budget.ts";

/** The latest Reading from each device, kept in memory. */
export interface LiveState {
  /** The P1 meter's latest Reading; its `receivedAt` is when the meter was last seen. */
  p1(): P1Reading | undefined;
  recordP1(reading: P1Reading): void;
  /** Zaptec's latest Reading; its `receivedAt` is when Zaptec was last read. */
  charger(): ChargerReading | undefined;
  recordCharger(reading: ChargerReading): void;
  /** Interruptions seen in this charge session; null while no car is connected. */
  interruptions(): number | null;
  /** Calls `listener` after every change. Returns a function that stops it. */
  onChange(listener: () => void): () => void;
}

export function createLiveState(): LiveState {
  let latestP1: P1Reading | undefined;
  let latestCharger: ChargerReading | undefined;
  let interruptions: number | null = null;
  const listeners = new Set<() => void>();

  function changed() {
    for (const listener of listeners) listener();
  }

  return {
    p1: () => latestP1,
    recordP1(reading) {
      latestP1 = reading;
      changed();
    },
    charger: () => latestCharger,
    interruptions: () => interruptions,
    recordCharger(reading) {
      interruptions = countInterruptions(interruptions, latestCharger, reading);
      latestCharger = reading;
      changed();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
