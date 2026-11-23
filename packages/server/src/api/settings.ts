import { type Settings, settings, settingsPath } from "@charge-on-solar/shared";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { SettingsStore } from "../settings.ts";
import { parseBody } from "./parse.ts";
import type { SessionEnv } from "./session.ts";

export function addSettingsRoutes(
  app: Hono<SessionEnv>,
  { store }: { store: SettingsStore }
) {
  app.get(settingsPath, (c) => c.json<Settings>(store.current()));

  app.put(settingsPath, async (c) => {
    // Every User may change the Settings in v1: being signed in is enough.
    if (!c.get("signedIn")) {
      throw new HTTPException(401, { message: "Not signed in" });
    }
    const next = await parseBody(c, settings);
    await store.update(next);
    return c.json<Settings>(store.current());
  });
}
