import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import packageJson from "../package.json" with { type: "json" };
import type { SessionEnv } from "./api/session.ts";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import type { Clock } from "./clock.ts";
import type { Mailer } from "./mailer.ts";
import { openStorage, type Storage } from "./storage/index.ts";

export interface ServerDependencies extends DataFiles {
  clock: Clock;
  mailer: Mailer;
  log: (line: string) => void;
  webRoot?: string;
}

export interface DataFiles {
  databaseFile: string;
  backupDir: string;
}

/** `DATA_DIR`, or `packages/server/data` when it is not set. */
export function dataDirFromEnv(env: Record<string, string | undefined>) {
  return resolve(
    env.DATA_DIR ?? fileURLToPath(new URL("../data", import.meta.url))
  );
}

/** Where the server keeps its database and backups inside a data directory. */
export function dataFiles(dataDir: string): DataFiles {
  return {
    databaseFile: join(dataDir, "chargeonsolar.db"),
    backupDir: join(dataDir, "backups"),
  };
}

export interface AssembledServer {
  app: Hono<SessionEnv>;
  storage: Storage;
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
  const auth = createAuth({ storage, ...dependencies });
  const app = createApp({ storage, auth, webRoot: dependencies.webRoot });
  return { app, storage, close: () => storage.close() };
}
