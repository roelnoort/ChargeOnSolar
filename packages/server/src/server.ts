import { join } from "node:path";
import type { Hono } from "hono";
import packageJson from "../package.json" with { type: "json" };
import { createApp } from "./app.ts";
import type { Clock } from "./clock.ts";
import { createLiveState } from "./domain/live-state.ts";
import type { P1Client } from "./p1/client.ts";
import { startP1Collector } from "./p1/collector.ts";
import { openStorage, type Storage } from "./storage/index.ts";

export interface ServerDependencies extends DataFiles {
  clock: Clock;
  log: (line: string) => void;
  /** The P1 meter's live stream. Without it, no P1 Readings come in. */
  p1Client?: P1Client;
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
  storage: Storage;
  close(): Promise<void>;
}

export async function assembleServer(
  dependencies: ServerDependencies
): Promise<AssembledServer> {
  const { clock, log, p1Client } = dependencies;
  const storage = await openStorage(dependencies);
  await storage.recordStartup({
    at: clock.now(),
    version: packageJson.version,
  });
  const live = createLiveState();
  const collector = p1Client
    ? startP1Collector({
        client: p1Client,
        clock,
        log,
        onReading(reading) {
          live.recordP1(reading);
          storage
            .recordP1Reading(reading)
            .catch((error: unknown) =>
              log(`P1 Reading not recorded: ${String(error)}`)
            );
        },
      })
    : undefined;
  if (!p1Client) log("No P1 meter configured");
  const app = createApp({
    storage,
    live,
    clock,
    webRoot: dependencies.webRoot,
  });
  return {
    app,
    storage,
    async close() {
      collector?.stop();
      await storage.close();
    },
  };
}
