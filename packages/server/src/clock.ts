/** Cancels a callback scheduled with `Clock.after`. */
export type Cancel = () => void;

/** Where the server reads the time and waits. Injected, so tests can control it. */
export interface Clock {
  now(): Date;
  /** Calls `callback` once, `milliseconds` from now. */
  after(milliseconds: number, callback: () => void): Cancel;
}

export const systemClock: Clock = {
  now: () => new Date(),
  after: (milliseconds, callback) => {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  },
};
