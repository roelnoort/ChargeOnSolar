import type { Clock } from "../clock.ts";

export interface FakeClock extends Clock {
  advance(milliseconds: number): void;
}

export function createFakeClock(start: Date): FakeClock {
  let now = start.getTime();
  return {
    now: () => new Date(now),
    advance: (milliseconds) => {
      now += milliseconds;
    },
  };
}
