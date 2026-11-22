import type { Health } from "@charge-on-solar/shared";
import type { Startup } from "../domain/startup.ts";

export function toHealth(startup: Startup): Health {
  return {
    status: "ok",
    version: startup.version,
    startedAt: startup.at.toISOString(),
  };
}
