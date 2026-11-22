// The main test seam: the whole server put together in-process, on a
// temporary SQLite file with the real migrations, and a controllable clock.
// The P1 meter and the Zaptec cloud are fakes the test drives. Later slices plug the other fake
// vendor clients and a fake mailer in here.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleServer, dataFiles } from "../server.ts";
import type { Storage } from "../storage/index.ts";
import { zaptecPollIntervalMs } from "../zaptec/collector.ts";
import { createFakeClock, type FakeClock } from "./fake-clock.ts";
import { createFakeP1Client, type FakeP1Client } from "./fake-p1-client.ts";
import {
  createFakeZaptecClient,
  type FakeChargerState,
  type FakeZaptecClient,
} from "./fake-zaptec-client.ts";

export interface TestServerOptions {
  /** The clock's starting time. */
  now?: Date;
  /** Reuse a data directory, to start again on the same database. */
  dataDir?: string;
  webRoot?: string;
  /** Start with the fake P1 meter unreachable. */
  p1Unreachable?: boolean;
  /** What the fake charger reports. Without it, reading Zaptec fails. */
  charger?: FakeChargerState;
  /** Start with the fake Zaptec cloud unreachable. */
  zaptecUnreachable?: boolean;
  mainFuseA?: number;
}

export interface TestServer {
  request(path: string, init?: RequestInit): Promise<Response>;
  clock: FakeClock;
  /** The fake P1 meter the server collects from. */
  p1: FakeP1Client;
  /** The fake Zaptec cloud the server reads the charger from. */
  zaptec: FakeZaptecClient;
  /**
   * Moves the clock on, a poll interval by default, and waits for the Zaptec
   * read that comes due to be handled.
   */
  pollZaptec(milliseconds?: number): Promise<void>;
  storage: Storage;
  /** Every line the server logged. */
  logs: string[];
  databaseFile: string;
  backupDir: string;
  /** Stops the server, and removes the data directory if it made one. */
  close(): Promise<void>;
}

export async function startTestServer(
  options: TestServerOptions = {}
): Promise<TestServer> {
  const ownsDataDir = options.dataDir === undefined;
  const dataDir =
    options.dataDir ?? (await mkdtemp(join(tmpdir(), "chargeonsolar-")));
  const clock = createFakeClock(
    options.now ?? new Date("2026-06-01T12:00:00.000Z")
  );
  const logs: string[] = [];
  const { databaseFile, backupDir } = dataFiles(dataDir);
  const p1 = createFakeP1Client(clock);
  p1.unreachable = options.p1Unreachable ?? false;
  const zaptec = createFakeZaptecClient(clock);
  zaptec.unreachable = options.zaptecUnreachable ?? false;
  if (options.charger) zaptec.set(options.charger);
  const firstRead = zaptec.whenRead();
  const server = await assembleServer({
    clock,
    databaseFile,
    backupDir,
    log: (line) => logs.push(line),
    p1Client: p1,
    zaptecClient: zaptec,
    mainFuseA: options.mainFuseA,
    webRoot: options.webRoot,
  });
  if (!p1.unreachable) await p1.whenConnected();
  await firstRead;
  await settle();
  let closed = false;

  return {
    request: async (path, init) =>
      server.app.request(`http://localhost${path}`, init),
    clock,
    p1,
    zaptec,
    async pollZaptec(milliseconds = zaptecPollIntervalMs) {
      const read = zaptec.whenRead();
      clock.advance(milliseconds);
      await read;
      await settle();
    },
    storage: server.storage,
    logs,
    databaseFile,
    backupDir,
    async close() {
      if (closed) return;
      closed = true;
      await server.close();
      if (ownsDataDir) await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** Lets the promise callbacks already queued run, e.g. a collector's. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
