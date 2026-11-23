import type { BucketWindow, PowerBucket } from "./power-bucket.ts";
import type { SolarInterval } from "./solar-interval.ts";

/** Five minutes of one day; each power is an average in watts, null when unknown. */
export interface DayTimelineBucket {
  start: Date;
  /** Null for a stretch Enphase had not been asked for yet. */
  solarProductionW: number | null;
  netPowerW: number | null;
  chargerPowerW: number | null;
}

export interface DayTimelineSources {
  window: BucketWindow;
  /** When Enphase was last asked for this day; undefined if never. */
  solarFetchedAt: Date | undefined;
  /** Enphase's intervals that ended within the day. */
  solarIntervals: SolarInterval[];
  netPower: PowerBucket[];
  chargerPower: PowerBucket[];
}

/**
 * Lays the day's Readings and Solar production out in buckets. Enphase
 * reports nothing for an interval without production, so a bucket that was
 * fetched but has no interval had no Solar production.
 */
export function toDayTimelineBuckets({
  window: { from, to, bucketMs },
  solarFetchedAt,
  solarIntervals,
  netPower,
  chargerPower,
}: DayTimelineSources): DayTimelineBucket[] {
  // An Enphase interval is identified by when it ended.
  const solarByEnd = byTime(
    solarIntervals.map((interval) => ({
      start: interval.endAt,
      averageW: interval.solarProductionW,
    }))
  );
  const netByStart = byTime(netPower);
  const chargerByStart = byTime(chargerPower);
  const fetchedUntil = solarFetchedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const buckets: DayTimelineBucket[] = [];
  for (let start = from.getTime(); start < to.getTime(); start += bucketMs) {
    const end = start + bucketMs;
    buckets.push({
      start: new Date(start),
      solarProductionW: end <= fetchedUntil ? (solarByEnd.get(end) ?? 0) : null,
      netPowerW: netByStart.get(start) ?? null,
      chargerPowerW: chargerByStart.get(start) ?? null,
    });
  }
  return buckets;
}

function byTime(buckets: PowerBucket[]): Map<number, number> {
  return new Map(
    buckets.map((bucket) => [bucket.start.getTime(), bucket.averageW])
  );
}
