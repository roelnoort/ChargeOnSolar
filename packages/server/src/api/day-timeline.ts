import {
  type DayTimeline,
  dayTimelineBucketMs,
  dayTimelinePath,
  dayTimelineQuery,
  settings,
} from "@charge-on-solar/shared";
import type { Hono } from "hono";
import {
  amsterdamDayBounds,
  nextAmsterdamTime,
} from "../domain/amsterdam-time.ts";
import {
  toDayTimelineBuckets,
  toShadowSwitches,
} from "../domain/day-timeline.ts";
import { overrideStatusOf } from "../domain/override.ts";
import { dailyFetchAt } from "../enphase/collector.ts";
import type { Storage } from "../storage/index.ts";
import { parseOr400 } from "./parse.ts";
import type { SessionEnv } from "./session.ts";

// A 25-hour day has 300 five-minute intervals; Enphase reports at most one each.
const solarIntervalsPerDayLimit = 300;
// Far more Manual overrides than a household sends by hand in a day.
const overridesPerDayLimit = 1000;
// The Shadow runner decides at most once per shortest tick interval.
const shadowDecisionsPerDayLimit =
  (25 * 3600) / (settings.shape.tickIntervalSeconds.minValue ?? 1);

export function addDayTimelineRoutes(
  app: Hono<SessionEnv>,
  { storage }: { storage: Storage }
) {
  app.get(dayTimelinePath, async (c) => {
    const { day } = parseOr400(dayTimelineQuery, c.req.query());
    const { start, end } = amsterdamDayBounds(day);
    const window = { from: start, to: end, bucketMs: dayTimelineBucketMs };
    const [
      solarFetchedAt,
      solarIntervals,
      netPower,
      chargerPower,
      shadowDecisions,
      overrides,
    ] = await Promise.all([
      storage.solarFetchedAt(start),
      storage.listSolarIntervals({
        from: start,
        to: end,
        limit: solarIntervalsPerDayLimit,
      }),
      storage.averageNetPowerPerBucket(window),
      storage.averageChargerPowerPerBucket(window),
      storage.listShadowDecisions({
        from: start,
        to: end,
        limit: shadowDecisionsPerDayLimit,
      }),
      storage.listManualOverridesSent({
        from: start,
        to: end,
        limit: overridesPerDayLimit,
      }),
    ]);
    const buckets = toDayTimelineBuckets({
      window,
      solarFetchedAt,
      solarCompleteAt: nextAmsterdamTime(
        start,
        dailyFetchAt.hour,
        dailyFetchAt.minute
      ),
      solarIntervals,
      netPower,
      chargerPower,
      shadowDecisions,
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
      shadowSwitches: toShadowSwitches(shadowDecisions).map((shadowSwitch) => ({
        ...shadowSwitch,
        at: shadowSwitch.at.toISOString(),
      })),
      overrides: overrides.map((override) => ({
        id: override.id,
        command: override.command,
        status: overrideStatusOf(override),
        sentAt: override.sentAt.toISOString(),
        userName: override.userName,
      })),
    };
    return c.json(body);
  });
}
