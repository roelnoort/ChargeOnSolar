import type { ChargerReading } from "./charger-reading.ts";
import type { P1Reading } from "./p1-reading.ts";
import type { RecordedShadowDecision } from "./shadow/recorded-decision.ts";
import type { SolarInterval } from "./solar-interval.ts";
import { countInterruptions } from "./switch-budget.ts";

/** One finished fetch from Enphase, and the latest interval stored after it. */
export interface SolarFetch {
  fetchedAt: Date;
  latest: SolarInterval | undefined;
}

/** The latest Reading from each device, and the latest Shadow decision, kept in memory. */
export interface LiveState {
  /** The P1 meter's latest Reading; its `receivedAt` is when the meter was last seen. */
  p1(): P1Reading | undefined;
  recordP1(reading: P1Reading): void;
  /** Zaptec's latest Reading; its `receivedAt` is when Zaptec was last read. */
  charger(): ChargerReading | undefined;
  recordCharger(reading: ChargerReading): void;
  /** The latest interval Enphase has reported. Display-only: never in Surplus. */
  solar(): SolarInterval | undefined;
  /** Sets the latest interval without a fetch, e.g. from storage at startup. */
  recordSolar(latest: SolarInterval | undefined): void;
  recordSolarFetch(fetch: SolarFetch): void;
  /** Calls `listener` after every fetch from Enphase. Returns a function that stops it. */
  onSolarFetch(listener: (fetch: SolarFetch) => void): () => void;
  /** Interruptions seen in this charge session; null while no car is connected. */
  interruptions(): number | null;
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
  let interruptions: number | null = null;
  let latestShadowDecision: RecordedShadowDecision | undefined;
  const listeners = new Set<() => void>();
  const decisionListeners = new Set<
    (decision: RecordedShadowDecision) => void
  >();
  let latestSolar: SolarInterval | undefined;
  const solarFetchListeners = new Set<(fetch: SolarFetch) => void>();

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
    solar: () => latestSolar,
    recordSolar(latest) {
      latestSolar = latest;
      changed();
    },
    recordSolarFetch(fetch) {
      latestSolar = fetch.latest;
      for (const listener of solarFetchListeners) listener(fetch);
      changed();
    },
    onSolarFetch(listener) {
      solarFetchListeners.add(listener);
      return () => solarFetchListeners.delete(listener);
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
