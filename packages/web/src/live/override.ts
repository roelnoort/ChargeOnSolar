import {
  type ManualOverride,
  type OverrideAvailability,
  type OverrideCommand,
  type OverrideStatus,
  overrideCommandLabels,
  overrideUnavailableLabels,
  type SwitchBudget,
} from "@charge-on-solar/shared";

/** What the Pause/Resume button shows, and why it is greyed out if it is. */
export function describeOverrideButton({
  availability,
  chargerStale,
  sending,
}: {
  availability: OverrideAvailability;
  /** This screen has not heard from the charger for too long. */
  chargerStale: boolean;
  /** This screen sent a command and has no answer yet. */
  sending: boolean;
}) {
  const reason = chargerStale
    ? "charger-offline"
    : sending
      ? "override-in-progress"
      : availability.unavailableReason;
  return {
    command: availability.command,
    label: overrideCommandLabels[availability.command],
    disabledBecause: reason === null ? null : overrideUnavailableLabels[reason],
  };
}

const confirmedTexts: Record<OverrideCommand, string> = {
  pause: "Confirmed: the charger is paused",
  resume: "Confirmed: the charger is charging again",
};

function statusText(override: ManualOverride): string {
  switch (override.status) {
    case "sending":
      return "Sending…";
    case "accepted":
      return "Accepted, waiting for the charger…";
    case "confirmed":
      return confirmedTexts[override.command];
    case "unconfirmed":
      return "Unconfirmed: the charger did not change within a minute";
    case "rejected": {
      const { code, reason } = override.rejection ?? {
        code: null,
        reason: "Zaptec refused the command",
      };
      return `Rejected: ${reason}${code === null ? "" : ` (code ${code})`}`;
    }
  }
}

const failedStatuses = new Set<OverrideStatus>(["rejected", "unconfirmed"]);

export function describeOverride(override: ManualOverride) {
  return {
    text: statusText(override),
    by: `${overrideCommandLabels[override.command]} by ${override.user.name}`,
    failed: failedStatuses.has(override.status),
  };
}

const stepOrder: Record<OverrideStatus, number> = {
  sending: 0,
  accepted: 1,
  confirmed: 2,
  rejected: 2,
  unconfirmed: 2,
};

/**
 * The newer of two steps: this screen's own answer and the stream's event
 * can arrive in either order.
 */
export function newerOverride(
  a: ManualOverride | undefined,
  b: ManualOverride | undefined
): ManualOverride | undefined {
  if (!a || !b) return a ?? b;
  if (a.id !== b.id) return a.id > b.id ? a : b;
  return stepOrder[b.status] > stepOrder[a.status] ? b : a;
}

export function describeSwitchBudget(budget: SwitchBudget | null) {
  if (!budget) return null;
  return `${budget.switchesLeft} of ${budget.switchesPerSession} switches left`;
}
