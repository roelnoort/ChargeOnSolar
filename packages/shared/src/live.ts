import { z } from "zod";
import { overrideAvailability, switchBudget } from "./override.ts";
import { phaseSetting } from "./phase-setting.ts";
import { shadowDecisionRecord } from "./shadow.ts";
import { liveSolar } from "./solar.ts";

export const livePath = "/api/live";
export const liveStreamPath = "/api/live/stream";
/** The SSE event name `GET /api/live/stream` sends the snapshot under. */
export const snapshotEvent = "snapshot";

/** The server reads Zaptec every 30 s; three missed reads mean the charger is offline. */
export const chargerStaleAfterMs = 90_000;

/** The grid's three phases, as the P1 meter and the charger name them. */
export const p1Phases = ["l1", "l2", "l3"] as const;
export const p1PhaseName = z.enum(p1Phases);
export type P1PhaseName = z.infer<typeof p1PhaseName>;

/** One phase as the P1 meter measured it. Null when the meter leaves it out. */
export const p1Phase = z.object({
  powerW: z.number().nullable(),
  currentA: z.number().nullable(),
  voltageV: z.number().nullable(),
});
export type P1Phase = z.infer<typeof p1Phase>;

/** The latest Reading from the P1 meter. */
export const p1Reading = z.object({
  /** Net power in watts: positive when importing, negative when exporting. */
  netPowerW: z.number(),
  phases: z.record(p1PhaseName, p1Phase),
  /** The meter's own timestamp, as it sent it (local time, no offset). */
  deviceTimestamp: z.string().nullable(),
});
export type P1Reading = z.infer<typeof p1Reading>;

/** What the server knows right now about one device. */
export function liveDevice<T extends z.ZodType>(reading: T) {
  return z.object({
    /** When the server last received a Reading from the device. */
    lastSeenAt: z.iso.datetime(),
    reading,
  });
}

/** What the charger is doing, from Zaptec's operation mode and FinalStopActive. */
export const chargerState = z.enum([
  "disconnected",
  "connected",
  "charging",
  "paused",
  "finished",
  "unknown",
]);
export type ChargerState = z.infer<typeof chargerState>;

/** Who sets the charger's current in Zaptec: its `availableCurrentMode`. */
export const zaptecMode = z.enum(["default", "scheduled", "apm", "unknown"]);
export type ZaptecMode = z.infer<typeof zaptecMode>;

/** The latest Reading of the charger, from the Zaptec cloud. */
export const chargerReading = z.object({
  /** Charger power in watts. */
  chargerPowerW: z.number().nullable(),
  /** The Charging current Zaptec has set, in amperes. */
  chargingCurrentSetA: z.number().nullable(),
  state: chargerState,
  /** Zaptec's NextScheduleEvent, as it sent it. */
  nextScheduleEvent: z.string().nullable(),
  phaseSetting: phaseSetting.nullable(),
  /** The charger's maximum current, in amperes. */
  maxCurrentA: z.number().nullable(),
  /** The current the charger draws on each phase, in amperes. */
  phaseCurrentsA: z.record(p1PhaseName, z.number().nullable()),
  zaptecMode,
  /** Whether Zaptec's load balancing (APM) is in control. */
  apmActive: z.boolean(),
  /** Whether Zaptec's own Surplus mode is active. */
  surplusModeActive: z.boolean().nullable(),
});
export type ChargerReading = z.infer<typeof chargerReading>;

/** What `GET /api/live` answers and each `snapshot` SSE event carries. */
export const liveSnapshot = z.object({
  /** The server's time when it took the snapshot. */
  at: z.iso.datetime(),
  /** Null until the P1 meter has sent its first Reading. */
  p1: liveDevice(p1Reading).nullable(),
  /** Null until Zaptec has been read once. */
  charger: liveDevice(chargerReading).nullable(),
  /**
   * Surplus in watts: Charger power minus Net power. Null without both a P1
   * Reading and Charger power.
   */
  surplusW: z.number().nullable(),
  /** The main fuse rating, in amperes. */
  mainFuseA: z.number(),
  /** Fuse headroom in amperes. Null without per-phase currents from both. */
  fuseHeadroomA: z.number().nullable(),
  /** Null until Enphase has reported any Solar production. */
  solar: liveSolar.nullable(),
  /**
   * House consumption in watts: Net power plus Solar production minus
   * Charger power. Null without all three.
   */
  houseConsumptionW: z.number().nullable(),
  /** What the Pause/Resume button does now. */
  override: overrideAvailability,
  /** Null while no car is connected. */
  switchBudget: switchBudget.nullable(),
  /** The latest Shadow decision. Null until the first one is made. */
  shadowDecision: shadowDecisionRecord.nullable(),
});
export type LiveSnapshot = z.infer<typeof liveSnapshot>;
