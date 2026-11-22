import type { Clock } from "../clock.ts";

export interface FakeClock extends Clock {
  set(now: Date): void;
  advance(milliseconds: number): void;
}

export function createFakeClock(start: Date): FakeClock {
  let now = start.getTime();
  return {
    now: () => new Date(now),
    set: (next) => {
      now = next.getTime();
    },
    advance: (milliseconds) => {
      now += milliseconds;
    },
  };
}
