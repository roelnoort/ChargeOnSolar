// Enphase's free Watt plan allows 1,000 calls a calendar month. How the
// budget is guarded: docs/adr/0002-enphase-call-budget.md
import type { CallBudget } from "@charge-on-solar/shared";
import { amsterdamDaysLeftInMonth, amsterdamMonth } from "./amsterdam-time.ts";

export const enphaseMonthlyCallLimit = 1000;
/** The most calls one fetch makes: a token renewal and the telemetry call. */
export const callsPerFetch = 2;

export function callBudget(used: number, now: Date): CallBudget {
  return {
    month: amsterdamMonth(now),
    limit: enphaseMonthlyCallLimit,
    used,
    remaining: Math.max(0, enphaseMonthlyCallLimit - used),
  };
}

const callCount = new Intl.NumberFormat("en-GB");

/**
 * Why a refresh may not run now, or undefined when it may: it must leave
 * enough calls for the month's daily fetches still to come, today's included.
 */
export function refreshRefusal(
  budget: CallBudget,
  now: Date
): string | undefined {
  const dailyFetchesLeft = amsterdamDaysLeftInMonth(now);
  const keptBack = dailyFetchesLeft * callsPerFetch;
  if (budget.remaining - callsPerFetch >= keptBack) return undefined;
  return (
    `Only ${callCount.format(budget.remaining)} of this month's ` +
    `${callCount.format(budget.limit)} Enphase calls are left, and ` +
    `${callCount.format(keptBack)} are kept for the daily fetches. ` +
    "Refreshing is possible again next month."
  );
}

/** Why the daily fetch may not run now, or undefined when it may. */
export function dailyFetchRefusal(budget: CallBudget): string | undefined {
  if (budget.remaining >= callsPerFetch) return undefined;
  return `Enphase call budget for ${budget.month} spent (${budget.used} of ${budget.limit} calls)`;
}
