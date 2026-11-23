import { z } from "zod";
import { phaseSetting } from "./phase-setting.ts";
import { settings } from "./settings.ts";

/** The lowest Charging current the charger can deliver, in amperes. */
export const minimumCurrentAmps = 6;

export const shadowDecisionsPath = "/api/shadow/decisions";
/** The SSE event name `GET /api/live/stream` sends each new Shadow decision under. */
export const decisionEvent = "decision";

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

/** The live data of the tick interval before a Shadow decision, averaged. Null when a device sent nothing. */
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
  /** The Phase setting the decision was made for; null on decisions recorded before it was kept. */
  phaseSetting: phaseSetting.nullable(),
  inputs: averagedInputs,
  zaptec: zaptecContext,
  rulesVersion: z.number(),
  /** The Settings the decision was made by. */
  settings,
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

/**
 * The Charger power the simulated charger would deliver after a Shadow
 * decision, in watts: 0 while it would not charge, null when the Phase
 * setting is unknown.
 */
export function shadowChargerPowerW({
  chargingCurrentA,
  phaseSetting,
  settings: { voltage },
}: Pick<
  ShadowDecisionRecord,
  "chargingCurrentA" | "phaseSetting" | "settings"
>): number | null {
  if (chargingCurrentA === null) return 0;
  if (phaseSetting === null) return null;
  return chargingCurrentA * voltage * phaseSetting;
}
