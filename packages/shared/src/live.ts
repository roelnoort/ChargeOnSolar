import { z } from "zod";

export const livePath = "/api/live";
export const liveStreamPath = "/api/live/stream";
/** The SSE event name `GET /api/live/stream` sends the snapshot under. */
export const snapshotEvent = "snapshot";

/** The grid's phases, as the P1 meter names them. */
export const p1PhaseName = z.enum(["l1", "l2", "l3"]);
export type P1PhaseName = z.infer<typeof p1PhaseName>;

/** One phase as the P1 meter measured it. Null when the meter leaves it out. */
export const p1Phase = z.object({
  powerW: z.number().nullable(),
  currentA: z.number().nullable(),
  voltageV: z.number().nullable(),
});
export type P1Phase = z.infer<typeof p1Phase>;

/** The latest Reading from the P1 meter. */
export const p1Reading = z.object({
  /** Net power in watts: positive when importing, negative when exporting. */
  netPowerW: z.number(),
  phases: z.record(p1PhaseName, p1Phase),
  /** The meter's own timestamp, as it sent it (local time, no offset). */
  deviceTimestamp: z.string().nullable(),
});
export type P1Reading = z.infer<typeof p1Reading>;

/** What the server knows right now about one device. */
export function liveDevice<T extends z.ZodType>(reading: T) {
  return z.object({
    /** When the server last received a Reading from the device. */
    lastSeenAt: z.iso.datetime(),
    reading,
  });
}

/** What `GET /api/live` answers and each `snapshot` SSE event carries. */
export const liveSnapshot = z.object({
  /** The server's time when it took the snapshot. */
  at: z.iso.datetime(),
  /** Null until the P1 meter has sent its first Reading. */
  p1: liveDevice(p1Reading).nullable(),
});
export type LiveSnapshot = z.infer<typeof liveSnapshot>;
