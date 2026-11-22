// The Override module: the only code that sends the charger a command. It
// follows each Manual override from Sending to Confirmed, Rejected or
// Unconfirmed, and keeps track of the charger's final-stop pauses.
import type {
  OverrideAvailability,
  OverrideCommand,
  OverrideStatus,
  OverrideUnavailableReason,
} from "@charge-on-solar/shared";
import type { Cancel, Clock } from "./clock.ts";
import type { ChargerReading } from "./domain/charger-reading.ts";
import type { LiveState } from "./domain/live-state.ts";
import {
  type CommandResult,
  confirms,
  type OpenPause,
  overrideAvailability,
  pauseChange,
} from "./domain/override.ts";
import type { Storage } from "./storage/index.ts";
import { messageOf } from "./supervision.ts";
import type { ZaptecClient } from "./zaptec/client.ts";

/** How long the charger has to show a command took effect. */
export const confirmationWaitMs = 60_000;

/** One Manual override, as far as it has got. */
export interface OverrideProgress {
  id: number;
  command: OverrideCommand;
  status: OverrideStatus;
  sentAt: Date;
  user: { id: number; name: string };
  rejection: { code: number | null; reason: string } | null;
}

/** The command cannot be sent in the charger's current state. */
export class OverrideUnavailable extends Error {
  readonly reason: OverrideUnavailableReason | null;
  constructor(reason: OverrideUnavailableReason | null) {
    super(reason ?? "Command not available");
    this.reason = reason;
  }
}

export interface Overrides {
  /** What the Pause/Resume button may do right now. */
  availability(): OverrideAvailability;
  /**
   * Sends a command for a User and answers once Zaptec has accepted or
   * rejected it. Throws `OverrideUnavailable` when the charger does not
   * allow it now.
   */
  send(
    command: OverrideCommand,
    user: { id: number; name: string }
  ): Promise<OverrideProgress>;
  /** Follows the charger: confirms a waiting command, opens and closes pauses. */
  onChargerReading(reading: ChargerReading): Promise<void>;
  /** Calls `listener` at every step of every Manual override. Returns a function that stops it. */
  onChange(listener: (progress: OverrideProgress) => void): () => void;
}

export interface OverridesOptions {
  /** Without it, the charger is never seen, so nothing can be sent. */
  client: ZaptecClient | undefined;
  storage: Storage;
  live: LiveState;
  clock: Clock;
  log: (line: string) => void;
}

interface AwaitingConfirmation {
  progress: OverrideProgress;
  answersPauseId: number | null;
  cancelWait: Cancel;
}

export async function createOverrides({
  client,
  storage,
  live,
  clock,
  log,
}: OverridesOptions): Promise<Overrides> {
  // Loaded once, then kept in step with every pause this module writes.
  let openPause: OpenPause | undefined = await storage.findOpenPause();
  let sending = false;
  let awaiting: AwaitingConfirmation | undefined;
  const listeners = new Set<(progress: OverrideProgress) => void>();
  let queue: Promise<void> = Promise.resolve();

  function emit(progress: OverrideProgress) {
    for (const listener of listeners) listener(progress);
  }

  /** Runs `step` after every step queued before it, so pause bookkeeping never interleaves. */
  function enqueue(step: () => Promise<void>): Promise<void> {
    queue = queue.then(step).catch((error: unknown) => {
      log(`Manual override bookkeeping failed: ${messageOf(error)}`);
    });
    return queue;
  }

  function availability(): OverrideAvailability {
    return overrideAvailability({
      reading: live.charger(),
      now: clock.now(),
      openPause,
      overrideInProgress: sending || awaiting !== undefined,
    });
  }

  function finish(
    current: AwaitingConfirmation,
    status: "confirmed" | "unconfirmed"
  ) {
    current.cancelWait();
    awaiting = undefined;
    emit({ ...current.progress, status });
  }

  async function confirmIfShown(reading: ChargerReading) {
    const current = awaiting;
    if (!current || !confirms(current.progress.command, reading)) return;
    if (current.progress.command === "pause") {
      openPause = await storage.confirmPause(
        current.progress.id,
        reading.receivedAt
      );
    } else {
      await storage.confirmResume(
        current.progress.id,
        current.answersPauseId,
        reading.receivedAt
      );
      if (openPause?.id === current.answersPauseId) openPause = undefined;
    }
    finish(current, "confirmed");
  }

  async function trackPause(reading: ChargerReading) {
    const change = pauseChange(openPause, reading);
    if (change.kind === "open") {
      openPause = await storage.openExternalPause(reading.receivedAt);
    } else if (change.kind === "close" && openPause) {
      await storage.closePause(openPause.id, reading.receivedAt, change.ending);
      openPause = undefined;
    }
  }

  function waitForConfirmation(
    progress: OverrideProgress,
    answersPauseId: number | null
  ) {
    const current: AwaitingConfirmation = {
      progress,
      answersPauseId,
      cancelWait: clock.after(confirmationWaitMs, () => {
        void enqueue(async () => {
          if (awaiting !== current) return;
          await storage.recordUnconfirmed(progress.id);
          finish(current, "unconfirmed");
        });
      }),
    };
    awaiting = current;
  }

  return {
    availability,
    async send(command, user) {
      const allowed = availability();
      if (allowed.command !== command || allowed.unavailableReason !== null) {
        throw new OverrideUnavailable(allowed.unavailableReason);
      }
      sending = true;
      try {
        const sentAt = clock.now();
        const answersPauseId =
          command === "resume" ? (openPause?.id ?? null) : null;
        const id = await storage.recordManualOverride({
          sentAt,
          user,
          command,
          answersPauseId,
        });
        const sent: OverrideProgress = {
          id,
          command,
          status: "sending",
          sentAt,
          user,
          rejection: null,
        };
        emit(sent);
        const result: CommandResult = client
          ? await client.sendCommand(command)
          : { accepted: false, code: null, reason: "No Zaptec account" };
        await storage.recordCommandResult(id, result);
        if (!result.accepted) {
          const rejected: OverrideProgress = {
            ...sent,
            status: "rejected",
            rejection: { code: result.code, reason: result.reason },
          };
          emit(rejected);
          return rejected;
        }
        const accepted: OverrideProgress = { ...sent, status: "accepted" };
        waitForConfirmation(accepted, answersPauseId);
        emit(accepted);
        return accepted;
      } finally {
        sending = false;
      }
    },
    onChargerReading(reading) {
      return enqueue(async () => {
        await confirmIfShown(reading);
        await trackPause(reading);
      });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
