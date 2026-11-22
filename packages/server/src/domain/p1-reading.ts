import type { P1Phase, P1PhaseName } from "@charge-on-solar/shared";

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
