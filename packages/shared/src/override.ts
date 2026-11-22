import { z } from "zod";

/** `POST`: send a Manual override to the charger. */
export const overridesPath = "/api/overrides";
/** The SSE event name `GET /api/live/stream` sends each Manual override change under. */
export const overrideEvent = "override";

export const overrideCommands = ["pause", "resume"] as const;
export const overrideCommand = z.enum(overrideCommands);
export type OverrideCommand = z.infer<typeof overrideCommand>;

export const overrideRequest = z.object({ command: overrideCommand });
export type OverrideRequest = z.infer<typeof overrideRequest>;

/** Why the Pause/Resume button cannot be used right now. */
export const overrideUnavailableReason = z.enum([
  "not-charging",
  "no-car",
  "charger-offline",
  "paused-by-car",
  "paused-by-schedule",
  "override-in-progress",
]);
export type OverrideUnavailableReason = z.infer<
  typeof overrideUnavailableReason
>;

/** How each reason reads, on the greyed-out button and in a refusal. */
export const overrideUnavailableLabels: Record<
  OverrideUnavailableReason,
  string
> = {
  "not-charging": "Not charging",
  "no-car": "No car connected",
  "charger-offline": "Charger offline",
  "paused-by-car": "Paused by the car",
  "paused-by-schedule": "Paused by a schedule",
  "override-in-progress": "Waiting for the charger",
};

/** What the Pause/Resume button does now, and why not when it cannot. */
export const overrideAvailability = z.object({
  command: overrideCommand,
  /** Null when the command can be sent. */
  unavailableReason: overrideUnavailableReason.nullable(),
});
export type OverrideAvailability = z.infer<typeof overrideAvailability>;

/**
 * Sending → Accepted (Zaptec took the command) → Confirmed (the charger's
 * state changed). Rejected and Unconfirmed are the ways it fails.
 */
export const overrideStatus = z.enum([
  "sending",
  "accepted",
  "confirmed",
  "rejected",
  "unconfirmed",
]);
export type OverrideStatus = z.infer<typeof overrideStatus>;

/** One Manual override and how far it got: what `POST /api/overrides` answers and each `override` event carries. */
export const manualOverride = z.object({
  id: z.number().int(),
  command: overrideCommand,
  status: overrideStatus,
  sentAt: z.iso.datetime(),
  user: z.object({ id: z.number().int(), name: z.string() }),
  /** Set only when Zaptec rejected the command. */
  rejection: z
    .object({ code: z.number().int().nullable(), reason: z.string() })
    .nullable(),
});
export type ManualOverride = z.infer<typeof manualOverride>;

/** The real Switch budget of the current charge session, as seen in the charger's state. */
export const switchBudget = z.object({
  switchesLeft: z.number().int(),
  switchesPerSession: z.number().int(),
});
export type SwitchBudget = z.infer<typeof switchBudget>;
