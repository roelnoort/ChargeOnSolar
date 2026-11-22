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

/** Net power is positive when importing, negative when exporting. */
export function describeNetPower(netPowerW: number) {
  const direction: NetPowerDirection =
    netPowerW > 0 ? "importing" : netPowerW < 0 ? "exporting" : "balanced";
  return {
    direction,
    label: directionLabels[direction],
    power: formatPower(netPowerW),
  };
}

/**
 * How old the P1 data is now: its age by the server's clock when the
 * snapshot was taken, plus the time since it arrived here. This way the
 * browser's clock never has to agree with the server's.
 */
export function p1DataAgeMs({
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
const staleAfterMs = 10_000;

export function describeDataAge(ageMs: number) {
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
