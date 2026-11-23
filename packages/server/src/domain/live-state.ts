import type { ChargerReading } from "./charger-reading.ts";
import type { P1Reading } from "./p1-reading.ts";
import type { SolarInterval } from "./solar-interval.ts";

/** One finished fetch from Enphase, and the latest interval stored after it. */
export interface SolarFetch {
  fetchedAt: Date;
  latest: SolarInterval | undefined;
}

/** The latest Reading from each device, kept in memory. */
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
  /** Calls `listener` after every change. Returns a function that stops it. */
  onChange(listener: () => void): () => void;
}

export function createLiveState(): LiveState {
  let latestP1: P1Reading | undefined;
  let latestCharger: ChargerReading | undefined;
  let latestSolar: SolarInterval | undefined;
  const listeners = new Set<() => void>();
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
    recordCharger(reading) {
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
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
