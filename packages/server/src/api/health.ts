import { type Health, health } from "@charge-on-solar/shared";
import type { Startup } from "../domain/startup.ts";

export function toHealth(startup: Startup): Health {
  return health.parse({
    status: "ok",
    version: startup.version,
    startedAt: startup.at.toISOString(),
  });
}
