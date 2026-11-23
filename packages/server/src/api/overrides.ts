import {
  type ManualOverride,
  overrideCommandLabels,
  overrideRequest,
  overridesPath,
  overrideUnavailableLabels,
} from "@charge-on-solar/shared";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  type OverrideProgress,
  type Overrides,
  OverrideUnavailable,
} from "../overrides.ts";
import { parseBody } from "./parse.ts";
import type { SessionEnv } from "./session.ts";

export function toManualOverride(progress: OverrideProgress): ManualOverride {
  return { ...progress, sentAt: progress.sentAt.toISOString() };
}

export function addOverrideRoutes(
  app: Hono<SessionEnv>,
  { overrides }: { overrides: Overrides }
) {
  app.post(overridesPath, async (c) => {
    // Every signed-in User may send a Manual override; the session is the permission.
    const { user } = c.get("signedIn");
    const { command } = await parseBody(c, overrideRequest);
    try {
      return c.json(
        toManualOverride(
          await overrides.send(command, { id: user.id, name: user.name })
        )
      );
    } catch (error) {
      if (!(error instanceof OverrideUnavailable)) throw error;
      throw new HTTPException(409, {
        message: error.reason
          ? overrideUnavailableLabels[error.reason]
          : `${overrideCommandLabels[command]} is not available`,
      });
    }
  });
}
