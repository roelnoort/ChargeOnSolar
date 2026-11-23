import {
  type ShadowSwitch,
  shadowChargerPowerW,
  shadowSwitchOf,
} from "@charge-on-solar/shared";
import type { BucketWindow, PowerBucket } from "./power-bucket.ts";
import type { RecordedShadowDecision } from "./shadow/recorded-decision.ts";
import type { SolarInterval } from "./solar-interval.ts";

/** Five minutes of one day; each power is an average in watts, null when unknown. */
export interface DayTimelineBucket {
  start: Date;
  /** Null for a stretch Enphase had not been asked for yet. */
  solarProductionW: number | null;
  netPowerW: number | null;
  chargerPowerW: number | null;
  /** Null without a Shadow decision in the bucket. */
  shadowChargerPowerW: number | null;
}

export interface DayTimelineSources {
  window: BucketWindow;
  /** When Enphase was last asked for this day; undefined if never. */
  solarFetchedAt: Date | undefined;
  /** A fetch from this moment on covers the whole day: the sun has set. */
  solarCompleteAt: Date;
  /** Enphase's intervals that ended within the day. */
  solarIntervals: SolarInterval[];
  netPower: PowerBucket[];
  chargerPower: PowerBucket[];
  /** The day's Shadow decisions, oldest first. */
  shadowDecisions: RecordedShadowDecision[];
}

/**
 * Lays the day's Readings and Solar production out in buckets. Enphase
 * reports nothing for an interval without production, so a bucket that was
 * fetched but has no interval had no Solar production.
 */
export function toDayTimelineBuckets({
  window: { from, to, bucketMs },
  solarFetchedAt,
  solarCompleteAt,
  solarIntervals,
  netPower,
  chargerPower,
  shadowDecisions,
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
  const shadowByStart = byTime(
    shadowChargerPowerPerBucket(shadowDecisions, { from, to, bucketMs })
  );
  const fetchedUntil = solarKnownUntil(solarFetchedAt, solarCompleteAt);
  const buckets: DayTimelineBucket[] = [];
  for (let start = from.getTime(); start < to.getTime(); start += bucketMs) {
    const end = start + bucketMs;
    buckets.push({
      start: new Date(start),
      solarProductionW: end <= fetchedUntil ? (solarByEnd.get(end) ?? 0) : null,
      netPowerW: netByStart.get(start) ?? null,
      chargerPowerW: chargerByStart.get(start) ?? null,
      shadowChargerPowerW: shadowByStart.get(start) ?? null,
    });
  }
  return buckets;
}

function solarKnownUntil(
  fetchedAt: Date | undefined,
  completeAt: Date
): number {
  if (!fetchedAt) return Number.NEGATIVE_INFINITY;
  if (fetchedAt.getTime() >= completeAt.getTime()) {
    return Number.POSITIVE_INFINITY;
  }
  return fetchedAt.getTime();
}

function byTime(buckets: PowerBucket[]): Map<number, number> {
  return new Map(
    buckets.map((bucket) => [bucket.start.getTime(), bucket.averageW])
  );
}

/**
 * The mean Charger power of the Shadow decisions in each bucket. Each
 * decision holds until the next tick, and ticks are evenly spaced, so the
 * mean weighs each the same as the time it held.
 */
function shadowChargerPowerPerBucket(
  decisions: RecordedShadowDecision[],
  { from, bucketMs }: BucketWindow
): PowerBucket[] {
  const sums = new Map<number, { totalW: number; count: number }>();
  for (const decision of decisions) {
    const powerW = shadowChargerPowerW({
      chargingCurrentA: decision.simulated.currentAmps,
      phaseSetting: decision.phaseSetting,
      settings: decision.stamp.settings,
    });
    if (powerW === null) continue;
    const start =
      from.getTime() +
      Math.floor((decision.at.getTime() - from.getTime()) / bucketMs) *
        bucketMs;
    const sum = sums.get(start) ?? { totalW: 0, count: 0 };
    sums.set(start, { totalW: sum.totalW + powerW, count: sum.count + 1 });
  }
  return [...sums].map(([start, { totalW, count }]) => ({
    start: new Date(start),
    averageW: totalW / count,
  }));
}

/** A Shadow start or stop of the day, as the domain keeps it. */
export type DayShadowSwitch = Omit<ShadowSwitch, "at"> & { at: Date };

/**
 * The day's Shadow starts and stops. A stop at the day's first decision
 * does not know the Charging current it stopped from.
 */
export function toShadowSwitches(
  decisions: RecordedShadowDecision[]
): DayShadowSwitch[] {
  return decisions.flatMap((recorded, index) => {
    const previousCurrentA =
      decisions[index - 1]?.simulated.currentAmps ?? null;
    const shadowSwitch = shadowSwitchOf(recorded.decision, previousCurrentA);
    return shadowSwitch ? [{ ...shadowSwitch, at: recorded.at }] : [];
  });
}
