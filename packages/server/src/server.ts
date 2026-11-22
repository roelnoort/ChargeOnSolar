import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import packageJson from "../package.json" with { type: "json" };
import type { SessionEnv } from "./api/session.ts";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import type { Clock } from "./clock.ts";
import { createLiveState } from "./domain/live-state.ts";
import type { Mailer } from "./mailer.ts";
import { createOverrides } from "./overrides.ts";
import type { P1Client } from "./p1/client.ts";
import { startP1Collector } from "./p1/collector.ts";
import { openStorage, type Storage } from "./storage/index.ts";
import type { ZaptecClient } from "./zaptec/client.ts";
import { startZaptecCollector } from "./zaptec/collector.ts";

export interface ServerDependencies extends DataFiles {
  clock: Clock;
  mailer: Mailer;
  log: (line: string) => void;
  /** The P1 meter's live stream. Without it, no P1 Readings come in. */
  p1Client?: P1Client;
  /** The Zaptec cloud. Without it, no charger Readings come in. */
  zaptecClient?: ZaptecClient;
  /** The main fuse rating, in amperes. 25 A unless given. */
  mainFuseA?: number;
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

const defaultMainFuseA = 25;

export interface AssembledServer {
  app: Hono<SessionEnv>;
  storage: Storage;
  close(): Promise<void>;
}

export async function assembleServer(
  dependencies: ServerDependencies
): Promise<AssembledServer> {
  const { clock, log, p1Client, zaptecClient } = dependencies;
  const storage = await openStorage(dependencies);
  await storage.recordStartup({
    at: clock.now(),
    version: packageJson.version,
  });
  const auth = createAuth({ storage, ...dependencies });
  const live = createLiveState();
  const overrides = await createOverrides({
    client: zaptecClient,
    storage,
    live,
    clock,
    log,
  });
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
  const zaptecCollector = zaptecClient
    ? startZaptecCollector({
        client: zaptecClient,
        clock,
        log,
        onReading(reading) {
          live.recordCharger(reading);
          void overrides.onChargerReading(reading);
          storage
            .recordChargerReading(reading)
            .catch((error: unknown) =>
              log(`Charger Reading not recorded: ${String(error)}`)
            );
        },
      })
    : undefined;
  if (!zaptecClient) log("No Zaptec account configured");
  const app = createApp({
    storage,
    auth,
    live,
    overrides,
    clock,
    mainFuseA: dependencies.mainFuseA ?? defaultMainFuseA,
    webRoot: dependencies.webRoot,
  });
  return {
    app,
    storage,
    async close() {
      collector?.stop();
      zaptecCollector?.stop();
      await storage.close();
    },
  };
}
