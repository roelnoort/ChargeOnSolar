import type { Clock } from "../clock.ts";

export interface FakeClock extends Clock {
  /** Moves time forward, calling every scheduled callback that comes due. */
  advance(milliseconds: number): void;
}

interface Scheduled {
  at: number;
  order: number;
  callback: () => void;
}

export function createFakeClock(start: Date): FakeClock {
  let now = start.getTime();
  let scheduled: Scheduled[] = [];
  let order = 0;

  function nextDue(until: number): Scheduled | undefined {
    const due = scheduled
      .filter((entry) => entry.at <= until)
      .sort((a, b) => a.at - b.at || a.order - b.order);
    return due[0];
  }

  return {
    now: () => new Date(now),
    after(milliseconds, callback) {
      const entry = { at: now + milliseconds, order: order++, callback };
      scheduled.push(entry);
      return () => {
        scheduled = scheduled.filter((other) => other !== entry);
      };
    },
    advance(milliseconds) {
      const until = now + milliseconds;
      for (let entry = nextDue(until); entry; entry = nextDue(until)) {
        const current = entry;
        scheduled = scheduled.filter((other) => other !== current);
        now = current.at;
        current.callback();
      }
      now = until;
    },
  };
}
