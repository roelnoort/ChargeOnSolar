/** Cancels a callback scheduled with the clock. */
export type Cancel = () => void;

/** Where the web app reads the time and waits. Injected, so tests can control it. */
export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
  /** Calls `callback` once, `milliseconds` from now. */
  after(milliseconds: number, callback: () => void): Cancel;
  /** Calls `callback` every `milliseconds`. */
  every(milliseconds: number, callback: () => void): Cancel;
}

export const browserClock: Clock = {
  now: () => Date.now(),
  after: (milliseconds, callback) => {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  },
  every: (milliseconds, callback) => {
    const timer = setInterval(callback, milliseconds);
    return () => clearInterval(timer);
  },
};
