import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import packageJson from "../package.json" with { type: "json" };
import type { SessionEnv } from "./api/session.ts";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import type { Clock } from "./clock.ts";
import { createLiveState } from "./domain/live-state.ts";
import type { EnphaseClientFactory } from "./enphase/client.ts";
import { startSolarCollector } from "./enphase/collector.ts";
import { createRefreshTokenStore } from "./enphase/refresh-token-store.ts";
import {
  countEnphaseCall,
  createSolarCollection,
} from "./enphase/solar-collection.ts";
import type { Mailer } from "./mailer.ts";
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
  /** The Enphase cloud. Without it, no Solar production comes in. */
  enphase?: EnphaseSetup;
  webRoot?: string;
}

export interface EnphaseSetup {
  client: EnphaseClientFactory;
  /** The AES-256 key the stored refresh token is encrypted with. */
  refreshTokenKey: Buffer;
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
  const { clock, log, p1Client, zaptecClient, enphase } = dependencies;
  const storage = await openStorage(dependencies);
  await storage.recordStartup({
    at: clock.now(),
    version: packageJson.version,
  });
  const auth = createAuth({ storage, ...dependencies });
  const live = createLiveState();
  live.recordSolar(await storage.latestSolarInterval());
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
          storage
            .recordChargerReading(reading)
            .catch((error: unknown) =>
              log(`Charger Reading not recorded: ${String(error)}`)
            );
        },
      })
    : undefined;
  if (!zaptecClient) log("No Zaptec account configured");
  const solar = enphase
    ? createSolarCollection({
        client: enphase.client({
          clock,
          refreshTokens: createRefreshTokenStore({
            storage,
            key: enphase.refreshTokenKey,
          }),
          countCall: () => countEnphaseCall(storage, clock),
        }),
        storage,
        live,
        clock,
      })
    : undefined;
  const solarCollector = solar
    ? startSolarCollector({ solar, clock, log })
    : undefined;
  if (!enphase) log("No Enphase account configured");
  const app = createApp({
    storage,
    auth,
    live,
    clock,
    mainFuseA: dependencies.mainFuseA ?? defaultMainFuseA,
    solar,
    webRoot: dependencies.webRoot,
  });
  return {
    app,
    storage,
    async close() {
      collector?.stop();
      zaptecCollector?.stop();
      solarCollector?.stop();
      await storage.close();
    },
  };
}
