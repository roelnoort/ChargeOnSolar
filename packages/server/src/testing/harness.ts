// The main test seam: the whole server put together in-process, on a
// temporary SQLite file with the real migrations, and a controllable clock.
// The P1 meter is a fake the test drives. Later slices plug the other fake
// vendor clients and a fake mailer in here.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleServer, dataFiles } from "../server.ts";
import type { Storage } from "../storage/index.ts";
import { createFakeClock, type FakeClock } from "./fake-clock.ts";
import { createFakeP1Client, type FakeP1Client } from "./fake-p1-client.ts";

export interface TestServerOptions {
  /** The clock's starting time. */
  now?: Date;
  /** Reuse a data directory, to start again on the same database. */
  dataDir?: string;
  webRoot?: string;
  /** Start with the fake P1 meter unreachable. */
  p1Unreachable?: boolean;
}

export interface TestServer {
  request(path: string, init?: RequestInit): Promise<Response>;
  clock: FakeClock;
  /** The fake P1 meter the server collects from. */
  p1: FakeP1Client;
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
  const server = await assembleServer({
    clock,
    databaseFile,
    backupDir,
    log: (line) => logs.push(line),
    p1Client: p1,
    webRoot: options.webRoot,
  });
  if (!p1.unreachable) await p1.whenConnected();
  let closed = false;

  return {
    request: async (path, init) =>
      server.app.request(`http://localhost${path}`, init),
    clock,
    p1,
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
