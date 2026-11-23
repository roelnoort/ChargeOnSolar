import {
  type DayOverride,
  type DayTimeline,
  type DayTimelineBucket,
  dayTimelineBucketMs,
  type ShadowDecisionRecord,
  type ShadowSwitch,
  shadowChargerPowerW,
  shadowSwitchesOf,
} from "@charge-on-solar/shared";

/**
 * A stretch of the day both charts draw: a loaded bucket, or the tick
 * before a Shadow decision that arrived since. Powers are averages in watts.
 */
export interface DayPoint extends DayTimelineBucket {
  end: string;
}

/**
 * The loaded buckets up to `loadedAt`, then a point for each Shadow decision
 * made after it. The bucket `loadedAt` falls in only holds the Readings up
 * to then, so it ends there.
 */
export function dayPoints(
  timeline: DayTimeline,
  loadedAt: number,
  decisions: ShadowDecisionRecord[]
): DayPoint[] {
  const loaded = timeline.buckets.flatMap((bucket) => {
    const start = Date.parse(bucket.start);
    if (start >= loadedAt) return [];
    const end = Math.min(start + dayTimelineBucketMs, loadedAt);
    return [{ ...bucket, end: new Date(end).toISOString() }];
  });
  let previousEnd = Math.min(loadedAt, Date.parse(timeline.end));
  const live = decisionsSince(timeline, loadedAt, decisions).map((record) => {
    const end = Date.parse(record.at);
    const tickMs = record.settings.tickIntervalSeconds * 1000;
    const start = Math.max(previousEnd, end - tickMs);
    previousEnd = end;
    return {
      start: new Date(start).toISOString(),
      end: record.at,
      solarProductionW: record.inputs.solarProductionW,
      netPowerW: record.inputs.netPowerW,
      chargerPowerW: record.inputs.chargerPowerW,
      shadowChargerPowerW: shadowChargerPowerW(record),
    };
  });
  return [...loaded, ...live];
}

interface Stretch {
  start: string;
  end: string;
}

/** Whether `at` falls in the point or bucket. */
export function covers({ start, end }: Stretch, at: number): boolean {
  return Date.parse(start) <= at && at < Date.parse(end);
}

/** The point or bucket `at` falls in, if any. */
export function pointAt<T extends Stretch>(
  points: T[],
  at: number
): T | undefined {
  return points.find((point) => covers(point, at));
}

/** The loaded Shadow starts and stops, then those of the decisions made since. */
export function dayShadowSwitches(
  timeline: DayTimeline,
  loadedAt: number,
  decisions: ShadowDecisionRecord[]
): ShadowSwitch[] {
  const live = shadowSwitchesOf(decisions).filter(({ at }) =>
    madeSince(timeline, loadedAt, at)
  );
  return [...timeline.shadowSwitches, ...live];
}

/**
 * The day's Manual overrides as far as each has got, oldest first. A
 * rejected one changed nothing, so it is not flagged.
 */
export function dayOverrides(
  timeline: DayTimeline,
  updates: DayOverride[]
): DayOverride[] {
  const byId = new Map(
    [...timeline.overrides, ...updates].map((override) => [
      override.id,
      override,
    ])
  );
  const start = Date.parse(timeline.start);
  const end = Date.parse(timeline.end);
  return [...byId.values()]
    .filter((override) => {
      const sentAt = Date.parse(override.sentAt);
      return override.status !== "rejected" && start <= sentAt && sentAt < end;
    })
    .sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
}

function decisionsSince(
  timeline: DayTimeline,
  loadedAt: number,
  decisions: ShadowDecisionRecord[]
): ShadowDecisionRecord[] {
  return decisions.filter(({ at }) => madeSince(timeline, loadedAt, at));
}

/** Whether a Shadow decision made `at` came after the load, within the day. */
function madeSince(timeline: DayTimeline, loadedAt: number, at: string) {
  const made = Date.parse(at);
  return made > loadedAt && made <= Date.parse(timeline.end);
}
