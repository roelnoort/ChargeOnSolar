import { z } from "zod";
import { solarMode } from "./solar-mode.ts";

export const shadowDecisionsPath = "/api/shadow/decisions";
/** The SSE event name `GET /api/live/stream` sends each new Shadow decision under. */
export const decisionEvent = "decision";

/** The lowest Charging current the charger delivers, in amperes. */
export const minimumCurrentAmps = 6;

/** What set the Charging current of a Shadow decision. */
export const currentLimit = z.enum([
  "surplus",
  "minimum-current",
  "charger-maximum",
  "fuse-headroom",
]);
export type CurrentLimit = z.infer<typeof currentLimit>;

/** Why a Shadow decision keeps things as they are. */
export const holdReason = z.enum([
  "surplus-too-low",
  "minimum-off-time",
  "switch-budget",
  "fuse-headroom",
  "minimum-on-time",
  "within-dead-band",
  "current-hold",
]);
export type HoldReason = z.infer<typeof holdReason>;

export const stopReason = z.enum(["surplus-too-low", "fuse-headroom"]);
export type StopReason = z.infer<typeof stopReason>;

export const chargeDecision = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("start"),
    currentAmps: z.number(),
    limitedBy: currentLimit,
  }),
  z.object({ kind: z.literal("stop"), reason: stopReason }),
  z.object({
    kind: z.literal("change-current"),
    currentAmps: z.number(),
    limitedBy: currentLimit,
  }),
  z.object({ kind: z.literal("hold"), reason: holdReason }),
]);
export type ChargeDecision = z.infer<typeof chargeDecision>;

/** What the engine decides once a car is plugged in, before any pause. */
export const carDecision = z.union([
  chargeDecision,
  z.object({ kind: z.literal("car-not-accepting") }),
]);
export type CarDecision = z.infer<typeof carDecision>;

export const shadowDecision = z.union([
  carDecision,
  z.object({ kind: z.literal("no-car") }),
  /** A final-stop pause wins; underlying is what the engine would do without it. */
  z.object({ kind: z.literal("paused"), underlying: carDecision }),
]);
export type ShadowDecision = z.infer<typeof shadowDecision>;

/** The settings the Shadow engine decides by. */
export const shadowSettings = z.object({
  startWindowMinutes: z.number(),
  stopWindowMinutes: z.number(),
  minimumOnTimeMinutes: z.number(),
  minimumOffTimeMinutes: z.number(),
  currentHoldMinutes: z.number(),
  deadBandAmps: z.number(),
  /** Per-phase voltage, fixed by the grid. */
  voltage: z.number(),
  mainFuseAmps: z.number(),
  minimumSolarWatts: z.number(),
  solarMode,
});
export type ShadowSettings = z.infer<typeof shadowSettings>;

/** The live data of the minute before a Shadow decision, averaged. Null when a device sent nothing. */
export const averagedInputs = z.object({
  surplusW: z.number().nullable(),
  netPowerW: z.number().nullable(),
  solarProductionW: z.number().nullable(),
  chargerPowerW: z.number().nullable(),
  fuseHeadroomA: z.number().nullable(),
  /** Surplus averaged over the start window. */
  startWindowSurplusW: z.number().nullable(),
  /** Surplus averaged over the stop window. */
  stopWindowSurplusW: z.number().nullable(),
  /** How old each device's latest Reading was at the decision, in ms. */
  dataAgeMs: z.object({
    p1: z.number().nullable(),
    charger: z.number().nullable(),
    solar: z.number().nullable(),
  }),
});
export type AveragedInputs = z.infer<typeof averagedInputs>;

/** What Zaptec itself was doing at the decision. */
export const zaptecContext = z.object({
  availableCurrentMode: z.number().nullable(),
  enabledFeatures: z.number().nullable(),
  surplusModeActive: z.boolean().nullable(),
  /** The Charging current Zaptec had actually set, in amperes. */
  chargeCurrentSetA: z.number().nullable(),
});
export type ZaptecContext = z.infer<typeof zaptecContext>;

/** One recorded Shadow decision. Never sent to the charger. */
export const shadowDecisionRecord = z.object({
  at: z.iso.datetime(),
  decision: shadowDecision,
  /** The Charging current the simulated charger is at after it; null while it would not charge. */
  chargingCurrentA: z.number().nullable(),
  inputs: averagedInputs,
  zaptec: zaptecContext,
  rulesVersion: z.number(),
  settings: shadowSettings,
});
export type ShadowDecisionRecord = z.infer<typeof shadowDecisionRecord>;

/** What `GET /api/shadow/decisions` answers. */
export const shadowDecisionList = z.object({
  decisions: z.array(shadowDecisionRecord),
});
export type ShadowDecisionList = z.infer<typeof shadowDecisionList>;

/** The query of `GET /api/shadow/decisions`: the window `[from, to)`, oldest first. */
export const shadowDecisionQuery = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  limit: z.coerce.number().int().min(1).max(1440).default(1440),
});
