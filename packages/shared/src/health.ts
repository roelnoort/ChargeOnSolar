import { z } from "zod";

export const healthPath = "/api/health";

/** What `GET /api/health` answers while the server is up. */
export const health = z.object({
  status: z.literal("ok"),
  version: z.string().min(1),
  /** When this server process started, as an ISO 8601 timestamp. */
  startedAt: z.iso.datetime(),
});
export type Health = z.infer<typeof health>;

/** The body of every error response from `/api/`. */
export const apiError = z.object({
  error: z.object({ status: z.number().int(), message: z.string() }),
});
export type ApiError = z.infer<typeof apiError>;
