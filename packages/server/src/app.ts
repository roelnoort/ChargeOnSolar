import { join } from "node:path";
import { type ApiError, healthPath } from "@charge-on-solar/shared";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { toHealth } from "./api/health.ts";
import { addLiveRoutes } from "./api/live.ts";
import type { Clock } from "./clock.ts";
import type { LiveState } from "./domain/live-state.ts";
import type { Storage } from "./storage/index.ts";

export interface AppDependencies {
  storage: Storage;
  live: LiveState;
  clock: Clock;
  /** The main fuse rating, in amperes. */
  mainFuseA: number;
  /** The built web app's directory. Without it, only `/api/` is served. */
  webRoot?: string;
}

export function createApp({
  storage,
  live,
  clock,
  mainFuseA,
  webRoot,
}: AppDependencies): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    const { status, message } =
      error instanceof HTTPException
        ? error
        : { status: 500 as const, message: "Internal server error" };
    if (status === 500) console.error(error);
    const body: ApiError = { error: { status, message } };
    return c.json(body, status);
  });

  app.get(healthPath, async (c) => {
    const startup = await storage.latestStartup();
    if (!startup) throw new HTTPException(503, { message: "Not started" });
    return c.json(toHealth(startup));
  });

  addLiveRoutes(app, { live, clock, mainFuseA });

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
