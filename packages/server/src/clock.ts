/** Where the server reads the time. Injected, so tests can control it. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
