export const p1Phases = ["l1", "l2", "l3"] as const;
export type P1PhaseName = (typeof p1Phases)[number];

/** One phase as the P1 meter measured it. Null when the meter leaves it out. */
export interface P1Phase {
  powerW: number | null;
  currentA: number | null;
  voltageV: number | null;
}

/** A Reading from the P1 meter. */
export interface P1Reading {
  /** When the server received it. */
  receivedAt: Date;
  /** The meter's own timestamp, as it sent it (local time, no offset). */
  deviceTimestamp: string | null;
  /** Positive when importing, negative when exporting. */
  netPowerW: number;
  phases: Record<P1PhaseName, P1Phase>;
}
