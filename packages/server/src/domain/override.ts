import {
  chargerStaleAfterMs,
  type OverrideAvailability,
  type OverrideCommand,
} from "@charge-on-solar/shared";
import {
  type ChargerReading,
  chargerOperationModes as operationModes,
} from "./charger-reading.ts";

/** Who made a pause: ChargeOnSolar's own Manual override, or someone outside it. */
export const pauseSources = ["chargeonsolar", "external"] as const;
export type PauseSource = (typeof pauseSources)[number];

export const pauseEndings = [
  "unplugged",
  "charging-restarted",
  "resumed-by-chargeonsolar",
] as const;
export type PauseEnding = (typeof pauseEndings)[number];

/** A final-stop pause of the charger that has not ended yet. */
export interface OpenPause {
  id: number;
  source: PauseSource;
  startedAt: Date;
}

export const commandResults = ["accepted", "rejected"] as const;

/** What Zaptec answered to a command. */
export type CommandResult =
  | { accepted: true }
  | { accepted: false; code: number | null; reason: string };

export const confirmationOutcomes = ["confirmed", "unconfirmed"] as const;
export type ConfirmationOutcome = (typeof confirmationOutcomes)[number];

/** A Manual override as recorded: who sent what, what Zaptec said, and what the charger did. */
export interface ManualOverrideRecord {
  id: number;
  sentAt: Date;
  /** Null once the User who sent it has been removed. */
  userId: number | null;
  userName: string;
  command: OverrideCommand;
  /** Null until Zaptec has answered. */
  commandResult: CommandResult | null;
  /** Null until the charger confirmed the command or the wait ran out. */
  confirmation: ConfirmationOutcome | null;
  /** For a Resume: the pause it answers. */
  answersPauseId: number | null;
}

/** A pause as recorded, open or ended. */
export interface PauseRecord extends OpenPause {
  /** The Manual override that made it; null for an External pause. */
  overrideId: number | null;
  endedAt: Date | null;
  ending: PauseEnding | null;
}

/**
 * The one place that decides whether a final-stop pause may be resumed. Every
 * pause qualifies, External pauses included; `pause` is here so that only
 * ChargeOnSolar's own pauses can be made to qualify.
 */
function resumeEligibility(
  reading: ChargerReading,
  _pause: OpenPause | undefined
): OverrideAvailability {
  const unavailable = (
    unavailableReason: OverrideAvailability["unavailableReason"]
  ) => ({ command: "resume" as const, unavailableReason });
  if (!reading.finalStopActive) return unavailable("paused-by-car");
  if (reading.nextScheduleEvent !== null) {
    return unavailable("paused-by-schedule");
  }
  return unavailable(null);
}

/** What the Pause/Resume button may do for this charger state. */
export function overrideAvailability({
  reading,
  now,
  openPause,
  overrideInProgress,
}: {
  reading: ChargerReading | undefined;
  now: Date;
  openPause: OpenPause | undefined;
  overrideInProgress: boolean;
}): OverrideAvailability {
  const command: OverrideCommand =
    reading?.operationMode === operationModes.stopped ? "resume" : "pause";
  const unavailable = (
    unavailableReason: OverrideAvailability["unavailableReason"]
  ) => ({ command, unavailableReason });
  if (
    !reading ||
    now.getTime() - reading.receivedAt.getTime() > chargerStaleAfterMs
  ) {
    return unavailable("charger-offline");
  }
  if (overrideInProgress) return unavailable("override-in-progress");
  switch (reading.operationMode) {
    case operationModes.charging:
      return unavailable(null);
    case operationModes.stopped:
      return resumeEligibility(reading, openPause);
    case operationModes.disconnected:
      return unavailable("no-car");
    case operationModes.connected:
      return unavailable("not-charging");
    default:
      return unavailable("charger-offline");
  }
}

/** Whether the charger's state shows a command has taken effect. */
export function confirms(
  command: OverrideCommand,
  reading: ChargerReading
): boolean {
  return command === "pause"
    ? isFinalStopPause(reading)
    : !reading.finalStopActive && isCarConnected(reading);
}

export type PauseChange =
  | { kind: "none" }
  | { kind: "open" }
  | { kind: "close"; ending: PauseEnding };

/** How a Reading changes the pause being tracked. */
export function pauseChange(
  openPause: OpenPause | undefined,
  reading: ChargerReading
): PauseChange {
  if (openPause) {
    if (reading.operationMode === operationModes.disconnected) {
      return { kind: "close", ending: "unplugged" };
    }
    if (isCarConnected(reading) && !reading.finalStopActive) {
      return { kind: "close", ending: "charging-restarted" };
    }
    return { kind: "none" };
  }
  return isFinalStopPause(reading) && reading.nextScheduleEvent === null
    ? { kind: "open" }
    : { kind: "none" };
}

function isFinalStopPause(reading: ChargerReading): boolean {
  return (
    reading.operationMode === operationModes.stopped && reading.finalStopActive
  );
}

function isCarConnected(reading: ChargerReading): boolean {
  return (
    reading.operationMode === operationModes.connected ||
    reading.operationMode === operationModes.charging ||
    reading.operationMode === operationModes.stopped
  );
}
