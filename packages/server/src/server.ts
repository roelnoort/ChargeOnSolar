import { join } from "node:path";
import type { Hono } from "hono";
import packageJson from "../package.json" with { type: "json" };
import { createApp } from "./app.ts";
import type { Clock } from "./clock.ts";
import { openStorage } from "./storage/index.ts";

export interface ServerDependencies extends DataFiles {
  clock: Clock;
  log: (line: string) => void;
  webRoot?: string;
}

export interface DataFiles {
  databaseFile: string;
  backupDir: string;
}

/** Where the server keeps its database and backups inside a data directory. */
export function dataFiles(dataDir: string): DataFiles {
  return {
    databaseFile: join(dataDir, "chargeonsolar.db"),
    backupDir: join(dataDir, "backups"),
  };
}

export interface AssembledServer {
  app: Hono;
  close(): Promise<void>;
}

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
