import type { P1Reading } from "./p1-reading.ts";

/** The latest Reading from each device, kept in memory. */
export interface LiveState {
  /** The P1 meter's latest Reading; its `receivedAt` is when the meter was last seen. */
  p1(): P1Reading | undefined;
  recordP1(reading: P1Reading): void;
  /** Calls `listener` after every change. Returns a function that stops it. */
  onChange(listener: () => void): () => void;
}

export function createLiveState(): LiveState {
  let latestP1: P1Reading | undefined;
  const listeners = new Set<() => void>();

  return {
    p1: () => latestP1,
    recordP1(reading) {
      latestP1 = reading;
      for (const listener of listeners) listener();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
