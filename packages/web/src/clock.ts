/** Where the web app reads the time and waits. Injected, so tests can control it. */
export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
  /** Calls `callback` once, `milliseconds` from now; returns a cancel. */
  after(milliseconds: number, callback: () => void): () => void;
}

export const browserClock: Clock = {
  now: () => Date.now(),
  after: (milliseconds, callback) => {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  },
};
