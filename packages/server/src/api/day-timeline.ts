import {
  type DayTimeline,
  dayTimelineBucketMs,
  dayTimelinePath,
  dayTimelineQuery,
} from "@charge-on-solar/shared";
import type { Hono } from "hono";
import { amsterdamDayBounds } from "../domain/amsterdam-time.ts";
import { toDayTimelineBuckets } from "../domain/day-timeline.ts";
import type { Storage } from "../storage/index.ts";
import { parseOr400 } from "./parse.ts";
import type { SessionEnv } from "./session.ts";

// A 25-hour day has 300 five-minute intervals; Enphase reports at most one each.
const solarIntervalsPerDayLimit = 300;

export function addDayTimelineRoutes(
  app: Hono<SessionEnv>,
  { storage }: { storage: Storage }
) {
  app.get(dayTimelinePath, async (c) => {
    const { day } = parseOr400(dayTimelineQuery, c.req.query());
    const { start, end } = amsterdamDayBounds(day);
    const window = { from: start, to: end, bucketMs: dayTimelineBucketMs };
    const [solarFetchedAt, solarIntervals, netPower, chargerPower] =
      await Promise.all([
        storage.solarFetchedAt(start),
        storage.listSolarIntervals({
          from: start,
          to: end,
          limit: solarIntervalsPerDayLimit,
        }),
        storage.averageNetPowerPerBucket(window),
        storage.averageChargerPowerPerBucket(window),
      ]);
    const buckets = toDayTimelineBuckets({
      window,
      solarFetchedAt,
      solarIntervals,
      netPower,
      chargerPower,
    });
    const body: DayTimeline = {
      day,
      start: start.toISOString(),
      end: end.toISOString(),
      solarFetchedAt: solarFetchedAt?.toISOString() ?? null,
      buckets: buckets.map((bucket) => ({
        ...bucket,
        start: bucket.start.toISOString(),
      })),
    };
    return c.json(body);
  });
}
