import { join } from "node:path";
import { type ApiError, healthPath } from "@charge-on-solar/shared";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { authRoutes } from "./api/auth.ts";
import { addDayTimelineRoutes } from "./api/day-timeline.ts";
import { toHealth } from "./api/health.ts";
import { addLiveRoutes } from "./api/live.ts";
import {
  requireCsrfHeader,
  requireSession,
  type SessionEnv,
} from "./api/session.ts";
import { addSolarRoutes } from "./api/solar.ts";
import type { Auth } from "./auth.ts";
import type { Clock } from "./clock.ts";
import type { LiveState } from "./domain/live-state.ts";
import type { SolarCollection } from "./enphase/solar-collection.ts";
import type { Storage } from "./storage/index.ts";

export interface AppDependencies {
  storage: Storage;
  auth: Auth;
  live: LiveState;
  clock: Clock;
  /** The main fuse rating, in amperes. */
  mainFuseA: number;
  /** Fetches from Enphase. Undefined while Enphase is not set up. */
  solar?: SolarCollection;
  /** The built web app's directory. Without it, only `/api/` is served. */
  webRoot?: string;
}

export function createApp({
  storage,
  auth,
  live,
  clock,
  mainFuseA,
  solar,
  webRoot,
}: AppDependencies): Hono<SessionEnv> {
  const app = new Hono<SessionEnv>();

  app.onError((error, c) => {
    const { status, message } =
      error instanceof HTTPException
        ? error
        : { status: 500 as const, message: "Internal server error" };
    if (status === 500) console.error(error);
    const body: ApiError = { error: { status, message } };
    return c.json(body, status);
  });

  app.use("/api/*", requireCsrfHeader, requireSession(auth));
  authRoutes(app, { auth, storage });

  app.get(healthPath, async (c) => {
    const startup = await storage.latestStartup();
    if (!startup) throw new HTTPException(503, { message: "Not started" });
    return c.json(toHealth(startup));
  });

  addLiveRoutes(app, { live, clock, mainFuseA });
  addSolarRoutes(app, { solar, storage, clock });
  addDayTimelineRoutes(app, { storage });

  app.all("/api/*", () => {
    throw new HTTPException(404, { message: "No such API route" });
  });

  if (webRoot) {
    app.use("*", serveStatic({ root: webRoot }));
    // Any other page path gets the app, which routes itself.
    app.get("*", serveStatic({ path: join(webRoot, "index.html") }));
  }

  return app;
}
