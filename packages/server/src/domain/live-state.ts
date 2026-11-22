import type { ChargerReading } from "./charger-reading.ts";
import type { P1Reading } from "./p1-reading.ts";
import type { RecordedShadowDecision } from "./shadow/recorded-decision.ts";

/** The latest Reading from each device, and the latest Shadow decision, kept in memory. */
export interface LiveState {
  /** The P1 meter's latest Reading; its `receivedAt` is when the meter was last seen. */
  p1(): P1Reading | undefined;
  recordP1(reading: P1Reading): void;
  /** Zaptec's latest Reading; its `receivedAt` is when Zaptec was last read. */
  charger(): ChargerReading | undefined;
  recordCharger(reading: ChargerReading): void;
  shadowDecision(): RecordedShadowDecision | undefined;
  recordShadowDecision(decision: RecordedShadowDecision): void;
  /** Calls `listener` after every change. Returns a function that stops it. */
  onChange(listener: () => void): () => void;
  /** Calls `listener` with each new Shadow decision, before the change listeners. */
  onShadowDecision(
    listener: (decision: RecordedShadowDecision) => void
  ): () => void;
}

export function createLiveState(): LiveState {
  let latestP1: P1Reading | undefined;
  let latestCharger: ChargerReading | undefined;
  let latestShadowDecision: RecordedShadowDecision | undefined;
  const listeners = new Set<() => void>();
  const decisionListeners = new Set<
    (decision: RecordedShadowDecision) => void
  >();

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
    recordCharger(reading) {
      latestCharger = reading;
      changed();
    },
    shadowDecision: () => latestShadowDecision,
    recordShadowDecision(decision) {
      latestShadowDecision = decision;
      for (const listener of decisionListeners) listener(decision);
      changed();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onShadowDecision(listener) {
      decisionListeners.add(listener);
      return () => decisionListeners.delete(listener);
    },
  };
}
