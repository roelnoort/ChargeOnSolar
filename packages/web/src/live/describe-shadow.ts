import {
  type CarDecision,
  type CurrentLimit,
  type HoldReason,
  minimumCurrentAmps,
  type ShadowDecisionRecord,
  type StopReason,
} from "@charge-on-solar/shared";
import { formatCurrent, formatPower, formatSignedPower } from "./describe.ts";

const minimumCurrent = `${minimumCurrentAmps} A`;

export interface ShadowDecisionSentence {
  sentence: string;
  /** During "Paused by you": what the decision would be without the pause. */
  withoutPause?: string;
}

/** The Shadow decision as one sentence, with its reason and limit. */
export function describeShadowDecision(
  record: ShadowDecisionRecord
): ShadowDecisionSentence {
  const { decision } = record;
  switch (decision.kind) {
    case "no-car":
      return { sentence: "No car" };
    case "paused":
      return {
        sentence: "Paused by you",
        withoutPause: describeCarDecision(decision.underlying, record),
      };
    default:
      return { sentence: describeCarDecision(decision, record) };
  }
}

function describeCarDecision(
  decision: CarDecision,
  record: ShadowDecisionRecord
): string {
  switch (decision.kind) {
    case "car-not-accepting":
      return "The car is not taking a charge";
    case "start":
    case "change-current":
      return `Would charge at ${decision.currentAmps} A, ${describeLimit(decision.limitedBy, record)}`;
    case "stop":
      return `Would stop charging (${describeStop(decision.reason, record)})`;
    case "hold": {
      const outcome =
        record.chargingCurrentA === null
          ? "Would not charge"
          : `Would keep charging at ${record.chargingCurrentA} A`;
      return `${outcome} (${describeHold(decision.reason, record.settings)})`;
    }
  }
}

function startWindowSurplus({ inputs, settings }: ShadowDecisionRecord) {
  return averageOver(inputs.startWindowSurplusW, settings.startWindowMinutes);
}

function averageOver(watts: number | null, minutes: number): string {
  const power = watts === null ? "unknown" : formatSignedPower(watts);
  return `${power} on average over ${minutes} minutes`;
}

function describeLimit(
  limit: CurrentLimit,
  record: ShadowDecisionRecord
): string {
  switch (limit) {
    case "surplus":
      return `limited by Surplus: ${startWindowSurplus(record)}`;
    case "minimum-current":
      return `the charger's minimum, with Surplus at ${startWindowSurplus(record)}`;
    case "charger-maximum":
      return "the charger's maximum";
    case "fuse-headroom": {
      const headroom = record.inputs.fuseHeadroomA;
      return `limited by Fuse headroom: ${headroom === null ? "unknown" : formatCurrent(headroom)}`;
    }
  }
}

function describeStop(
  reason: StopReason,
  { inputs, settings }: ShadowDecisionRecord
): string {
  switch (reason) {
    case "surplus-too-low":
      return `Surplus: ${averageOver(inputs.stopWindowSurplusW, settings.stopWindowMinutes)}, ${surplusShortfall(settings)}`;
    case "fuse-headroom":
      return `Fuse headroom below ${minimumCurrent}`;
  }
}

/** How Surplus falls short in the Solar mode: Solar only needs the minimum current of it. */
function surplusShortfall({
  solarMode,
  minimumSolarWatts,
}: ShadowDecisionRecord["settings"]): string {
  if (solarMode === "solar-only") return `below ${minimumCurrent}`;
  return minimumSolarWatts > 0
    ? `not above ${formatPower(minimumSolarWatts)}`
    : "no Surplus";
}

function describeHold(
  reason: HoldReason,
  settings: ShadowDecisionRecord["settings"]
): string {
  const texts: Record<HoldReason, string> = {
    "surplus-too-low":
      settings.solarMode === "solar-only"
        ? `Surplus below ${minimumCurrent}`
        : surplusShortfall(settings),
    "minimum-off-time": `waiting out the minimum off-time of ${settings.minimumOffTimeMinutes} minutes`,
    "switch-budget": "the Switch budget is used up",
    "fuse-headroom": `Fuse headroom below ${minimumCurrent}`,
    "minimum-on-time": `Surplus too low, but within the minimum on-time of ${settings.minimumOnTimeMinutes} minutes`,
    "within-dead-band": "the Surplus has not changed enough to adjust",
    "current-hold": `holding each Charging current for ${settings.currentHoldMinutes} minutes`,
  };
  return texts[reason];
}
