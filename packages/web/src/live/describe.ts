import type {
  CallBudget,
  ChargerState,
  PhaseSetting,
  ZaptecMode,
} from "@charge-on-solar/shared";
import { amsterdamClockTime } from "../amsterdam-clock.ts";

export const netPowerDirections = [
  "importing",
  "exporting",
  "balanced",
] as const;
export type NetPowerDirection = (typeof netPowerDirections)[number];

const directionLabels: Record<NetPowerDirection, string> = {
  importing: "Importing",
  exporting: "Exporting",
  balanced: "Balanced",
};

export function formatPower(watts: number): string {
  const size = Math.abs(watts);
  return size < 1000
    ? `${Math.round(size)} W`
    : `${(size / 1000).toFixed(2)} kW`;
}

/** A power that keeps its sign, such as a Surplus. */
export function formatSignedPower(watts: number): string {
  return `${watts < 0 ? "−" : ""}${formatPower(watts)}`;
}

/** Net power is positive when importing, negative when exporting. */
function netPowerDirection(netPowerW: number): NetPowerDirection {
  return netPowerW > 0 ? "importing" : netPowerW < 0 ? "exporting" : "balanced";
}

export function describeNetPower(netPowerW: number) {
  const direction = netPowerDirection(netPowerW);
  return {
    direction,
    label: directionLabels[direction],
    power: formatPower(netPowerW),
  };
}

const gridLabels: Record<NetPowerDirection, string> = {
  importing: "From grid",
  exporting: "To grid",
  balanced: "Grid",
};

export function describeGrid(netPowerW: number) {
  const direction = netPowerDirection(netPowerW);
  return {
    direction,
    label: gridLabels[direction],
    power: formatPower(netPowerW),
  };
}

export function formatCurrent(amperes: number): string {
  return `${amperes.toFixed(1)} A`;
}

const chargerStateLabels: Record<ChargerState, string> = {
  disconnected: "No car connected",
  connected: "Car connected, waiting",
  charging: "Charging",
  paused: "Paused",
  finished: "Finished",
  unknown: "Unknown",
};

export function describeChargerState(state: ChargerState): string {
  return chargerStateLabels[state];
}

export function describePhaseSetting(setting: PhaseSetting | null): string {
  if (setting === null) return "Unknown";
  return setting === 1 ? "1 phase" : "3 phases";
}

const zaptecModeLabels: Record<ZaptecMode, string> = {
  apm: "Load balancing (APM)",
  default: "Default",
  scheduled: "Scheduled",
  unknown: "Unknown",
};

export function describeZaptecMode(mode: ZaptecMode): string {
  return zaptecModeLabels[mode];
}

/** The warning to show when APM is not known to guard the main fuse. */
export function describeApmWarning(mode: ZaptecMode): string | null {
  if (mode === "apm") return null;
  if (mode === "unknown") {
    return "Zaptec did not report its mode, so ChargeOnSolar cannot tell whether load balancing (APM) guards the main fuse.";
  }
  return `Zaptec's load balancing (APM) is not active: Zaptec is in ${describeZaptecMode(mode)} mode, so it does not guard the main fuse.`;
}

/**
 * How old a device's data is now: its age by the server's clock when the
 * snapshot was taken, plus the time since it arrived here. This way the
 * browser's clock never has to agree with the server's.
 */
export function dataAgeMs({
  serverAt,
  lastSeenAt,
  receivedAt,
  now,
}: {
  serverAt: string;
  lastSeenAt: string;
  receivedAt: number;
  now: number;
}): number {
  return Date.parse(serverAt) - Date.parse(lastSeenAt) + (now - receivedAt);
}

// The meter pushes about once a second; this much silence means trouble.
export const p1StaleAfterMs = 10_000;

export function describeDataAge(ageMs: number, staleAfterMs = p1StaleAfterMs) {
  const seconds = Math.floor(ageMs / 1000);
  const text =
    seconds < 1
      ? "just now"
      : seconds < 60
        ? `${seconds} s old`
        : seconds < 3600
          ? `${Math.floor(seconds / 60)} min old`
          : `${Math.floor(seconds / 3600)} h old`;
  return { text, stale: ageMs > staleAfterMs };
}

/** When Solar production was last reported, as "as of hh:mm". */
export function describeAsOf(asOf: string): string {
  return `as of ${amsterdamClockTime.format(new Date(asOf))}`;
}

const callCount = new Intl.NumberFormat("en-GB");

export function describeCallBudget({ remaining, limit }: CallBudget): string {
  return `${callCount.format(remaining)} of ${callCount.format(limit)} Enphase calls left this month`;
}
