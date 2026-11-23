import { z } from "zod";

export const solarRefreshPath = "/api/solar/refresh";
export const solarBudgetPath = "/api/solar/budget";
/** The SSE event `GET /api/live/stream` sends after each fetch from Enphase. */
export const solarUpdatedEvent = "solar-updated";

/** The latest Solar production Enphase has reported. Display-only: never in Surplus. */
export const liveSolar = z.object({
  /** When the 5-minute interval it was averaged over ended. */
  asOf: z.iso.datetime(),
  /** Solar production in watts, averaged over the interval. */
  solarProductionW: z.number(),
});
export type LiveSolar = z.infer<typeof liveSolar>;

/** How many of this calendar month's Enphase calls are used and left. */
export const callBudget = z.object({
  /** The calendar month, Europe/Amsterdam, as YYYY-MM. */
  month: z.string(),
  limit: z.number().int(),
  used: z.number().int(),
  remaining: z.number().int(),
});
export type CallBudget = z.infer<typeof callBudget>;

/** What `POST /api/solar/refresh` answers once the fetch is done. */
export const solarRefreshResponse = z.object({
  solar: liveSolar.nullable(),
  budget: callBudget,
});
export type SolarRefreshResponse = z.infer<typeof solarRefreshResponse>;

/** What each `solar-updated` SSE event carries. */
export const solarUpdated = z.object({
  /** When the server finished fetching from Enphase. */
  fetchedAt: z.iso.datetime(),
  solar: liveSolar.nullable(),
});
export type SolarUpdated = z.infer<typeof solarUpdated>;
