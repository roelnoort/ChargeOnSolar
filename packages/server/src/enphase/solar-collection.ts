import type { CallBudget } from "@charge-on-solar/shared";
import type { Clock } from "../clock.ts";
import { amsterdamDayStart, amsterdamMonth } from "../domain/amsterdam-time.ts";
import {
  CallBudgetRefusal,
  callBudget,
  dailyFetchRefusal,
  refreshRefusal,
  retryRefusal,
  spentRefusal,
} from "../domain/call-budget.ts";
import type { LiveState } from "../domain/live-state.ts";
import type { SolarInterval } from "../domain/solar-interval.ts";
import type { Storage } from "../storage/index.ts";
import type { EnphaseClient } from "./client.ts";

export interface SolarCollection {
  /** Fetches today's intervals now, for a User. */
  refresh(): Promise<SolarInterval | undefined>;
  /** Fetches the intervals of the day starting at `dayStart`, on schedule. */
  fetchDay(dayStart: Date): Promise<void>;
  /**
   * Tries a failed daily fetch again, leaving the calls the daily fetches
   * from `nextDailyFetch` on will need.
   */
  retryDay(dayStart: Date, nextDailyFetch: Date): Promise<void>;
}

export interface SolarCollectionOptions {
  client: EnphaseClient;
  storage: Storage;
  live: LiveState;
  clock: Clock;
}

/** This month's Enphase call budget, as counted so far. */
export async function currentCallBudget(
  storage: Storage,
  clock: Clock
): Promise<CallBudget> {
  const now = clock.now();
  return callBudget(await storage.enphaseCalls(amsterdamMonth(now)), now);
}

/**
 * Counts one call against this month's budget, or refuses it once the
 * month's calls are spent, so the limit holds even for a fetch that makes
 * more calls than budgeted.
 */
export async function countEnphaseCall(
  storage: Storage,
  clock: Clock
): Promise<void> {
  const budget = await currentCallBudget(storage, clock);
  const reason = spentRefusal(budget);
  if (reason) throw new CallBudgetRefusal(reason);
  await storage.countEnphaseCalls(budget.month, 1);
}

/**
 * Fetches from Enphase within the call budget, stores what comes back, and
 * tells the live state. One fetch at a time: a refresh asked for during a
 * fetch waits for it instead of making another.
 */
export function createSolarCollection({
  client,
  storage,
  live,
  clock,
}: SolarCollectionOptions): SolarCollection {
  let inFlight: Promise<SolarInterval | undefined> | undefined;

  async function fetchAndStore(dayStart: Date) {
    const intervals = await client.productionIntervals(dayStart);
    await storage.upsertSolarIntervals(intervals);
    const latest = await storage.latestSolarInterval();
    live.recordSolarFetch({ fetchedAt: clock.now(), latest });
    return latest;
  }

  function fetchOnce(
    dayStart: Date,
    refusal: (budget: CallBudget) => string | undefined
  ) {
    inFlight ??= (async () => {
      try {
        const reason = refusal(await currentCallBudget(storage, clock));
        if (reason) throw new CallBudgetRefusal(reason);
        return await fetchAndStore(dayStart);
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  }

  return {
    refresh() {
      const now = clock.now();
      return fetchOnce(amsterdamDayStart(now), (budget) =>
        refreshRefusal(budget, now)
      );
    },
    async fetchDay(dayStart) {
      await fetchOnce(dayStart, dailyFetchRefusal);
    },
    async retryDay(dayStart, nextDailyFetch) {
      await fetchOnce(dayStart, (budget) =>
        retryRefusal(budget, nextDailyFetch)
      );
    },
  };
}
