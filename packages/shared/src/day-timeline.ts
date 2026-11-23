import { z } from "zod";
import { type ManualOverride, manualOverride } from "./override.ts";
import type { ShadowDecision } from "./shadow.ts";

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
  /**
   * The Charger power had the Shadow decisions been sent: the average over
   * the bucket's Shadow decisions. Null when none was made in it.
   */
  shadowChargerPowerW: z.number().nullable(),
});
export type DayTimelineBucket = z.infer<typeof dayTimelineBucket>;

export const shadowSwitchKinds = ["start", "stop"] as const;

/** A moment the simulated charger would have started or stopped charging. */
export const shadowSwitch = z.object({
  at: z.iso.datetime(),
  kind: z.enum(shadowSwitchKinds),
  /** The Charging current it started at, or stopped from; null when unknown. */
  currentA: z.number().nullable(),
});
export type ShadowSwitch = z.infer<typeof shadowSwitch>;

/** A Shadow start or stop, with its moment in whichever form the caller keeps it. */
export type ShadowSwitchAt<At> = Omit<ShadowSwitch, "at"> & { at: At };

/** A Shadow decision, as far as its start or stop goes. */
export interface ShadowSwitchStep<At> {
  at: At;
  decision: ShadowDecision;
  /** The simulated charger's Charging current after the decision. */
  chargingCurrentA: number | null;
}

/**
 * The starts and stops of consecutive Shadow decisions, oldest first. A stop
 * at the first decision does not know the Charging current it stopped from.
 */
export function shadowSwitchesOf<At>(
  steps: ShadowSwitchStep<At>[]
): ShadowSwitchAt<At>[] {
  return steps.flatMap(({ at, decision }, index): ShadowSwitchAt<At>[] => {
    if (decision.kind === "start") {
      return [{ at, kind: "start", currentA: decision.currentAmps }];
    }
    if (decision.kind === "stop") {
      const currentA = steps[index - 1]?.chargingCurrentA ?? null;
      return [{ at, kind: "stop", currentA }];
    }
    return [];
  });
}

/** A Manual override as the Day tab flags it: what was sent, by which User. */
export const dayOverride = manualOverride
  .pick({ id: true, command: true, status: true, sentAt: true })
  .extend({ userName: z.string() });
export type DayOverride = z.infer<typeof dayOverride>;

export function toDayOverride({
  id,
  command,
  status,
  sentAt,
  user,
}: ManualOverride): DayOverride {
  return { id, command, status, sentAt, userName: user.name };
}

/** One Europe/Amsterdam day in 5-minute buckets, midnight to midnight. */
export const dayTimeline = z.object({
  day: localDay,
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  /** When Enphase was last asked for this day's Solar production; null if never. */
  solarFetchedAt: z.iso.datetime().nullable(),
  buckets: z.array(dayTimelineBucket),
  /** The day's Shadow starts and stops, oldest first. */
  shadowSwitches: z.array(shadowSwitch),
  /** The Manual overrides sent during the day, oldest first. */
  overrides: z.array(dayOverride),
});
export type DayTimeline = z.infer<typeof dayTimeline>;
