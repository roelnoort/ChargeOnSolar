import type { Cancel, Clock } from "../clock.ts";
import {
  amsterdamDayStart,
  nextAmsterdamTime,
} from "../domain/amsterdam-time.ts";
import { CallBudgetRefusal } from "../domain/call-budget.ts";
import { type BackOff, backOffMs, messageOf } from "../supervision.ts";
import type { SolarCollection } from "./solar-collection.ts";

export interface SolarCollectorOptions {
  solar: SolarCollection;
  clock: Clock;
  log: (line: string) => void;
}

export interface SolarCollector {
  stop(): void;
}

// Late enough that the sun has set, even at midsummer, so the day is complete.
export const dailyFetchAt = { hour: 23, minute: 30 } as const;
const retryBackOff: BackOff = { firstMs: 5 * 60_000, longestMs: 60 * 60_000 };

/**
 * Fetches the day's production intervals once a day, Europe/Amsterdam time,
 * retrying with back-off while Enphase fails. Never throws, so an Enphase
 * outage cannot take the server or the other collectors down.
 */
export function startSolarCollector({
  solar,
  clock,
  log,
}: SolarCollectorOptions): SolarCollector {
  let stopped = false;
  let cancelNext: Cancel | undefined;

  function scheduleDaily() {
    const now = clock.now();
    const next = nextAmsterdamTime(now, dailyFetchAt.hour, dailyFetchAt.minute);
    cancelNext = clock.after(
      next.getTime() - now.getTime(),
      () => void attempt(amsterdamDayStart(next), 0)
    );
  }

  async function attempt(dayStart: Date, failuresBefore: number) {
    cancelNext = undefined;
    try {
      await solar.fetchDay(dayStart);
      if (stopped) return;
      if (failuresBefore > 0) log("Enphase reachable again");
    } catch (error) {
      if (stopped) return;
      if (error instanceof CallBudgetRefusal) {
        log(`Daily Enphase fetch skipped: ${error.message}`);
      } else {
        const failures = failuresBefore + 1;
        const delay = backOffMs(retryBackOff, failures);
        log(`Enphase unreachable: ${messageOf(error)}`);
        log(`Fetching from Enphase again in ${delay / 60_000} min`);
        cancelNext = clock.after(delay, () => void attempt(dayStart, failures));
        return;
      }
    }
    scheduleDaily();
  }

  scheduleDaily();

  return {
    stop() {
      stopped = true;
      cancelNext?.();
    },
  };
}
