import { z } from "zod";

export const dayTimelinePath = "/api/day-timeline";

/** How long one bucket of the day timeline lasts. */
export const dayTimelineBucketMs = 5 * 60_000;

/** A Europe/Amsterdam calendar day, as YYYY-MM-DD. */
export const localDay = z.iso.date();
export type LocalDay = z.infer<typeof localDay>;

/** The query `GET /api/day-timeline` takes. */
export const dayTimelineQuery = z.object({ day: localDay });

/**
 * Five minutes of one day: each power is the average over the bucket, in
 * watts, or null when nothing was recorded for it.
 */
export const dayTimelineBucket = z.object({
  start: z.iso.datetime(),
  /** Null when Enphase had not been asked for this stretch yet. */
  solarProductionW: z.number().nullable(),
  /** Positive when importing, negative when exporting. */
  netPowerW: z.number().nullable(),
  chargerPowerW: z.number().nullable(),
});
export type DayTimelineBucket = z.infer<typeof dayTimelineBucket>;

/** One Europe/Amsterdam day in 5-minute buckets, midnight to midnight. */
export const dayTimeline = z.object({
  day: localDay,
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  /** When Enphase was last asked for this day's Solar production; null if never. */
  solarFetchedAt: z.iso.datetime().nullable(),
  buckets: z.array(dayTimelineBucket),
});
export type DayTimeline = z.infer<typeof dayTimeline>;
