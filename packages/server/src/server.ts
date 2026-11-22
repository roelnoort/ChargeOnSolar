import type { Hono } from "hono";
import packageJson from "../package.json" with { type: "json" };
import { createApp } from "./app.ts";
import type { Clock } from "./clock.ts";
import { openStorage } from "./storage/index.ts";

export interface ServerDependencies {
  clock: Clock;
  databaseFile: string;
  backupDir: string;
  log: (line: string) => void;
  webRoot?: string;
}

export interface AssembledServer {
  app: Hono;
  close(): Promise<void>;
}

/**
 * Puts the whole server together: opens storage (backup, then migrations),
 * records this start, and builds the HTTP app on top.
 */
export async function assembleServer(
  dependencies: ServerDependencies
): Promise<AssembledServer> {
  const storage = await openStorage(dependencies);
  await storage.recordStartup({
    at: dependencies.clock.now(),
    version: packageJson.version,
  });
  const app = createApp({ storage, webRoot: dependencies.webRoot });
  return { app, close: () => storage.close() };
}
