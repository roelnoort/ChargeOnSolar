// The main test seam: the whole server put together in-process, on a
// temporary SQLite file with the real migrations, and a controllable clock.
// Later slices plug fake vendor clients and a fake mailer in here.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleServer, dataFiles } from "../server.ts";
import { createFakeClock, type FakeClock } from "./fake-clock.ts";

export interface TestServerOptions {
  /** The clock's starting time. */
  now?: Date;
  /** Reuse a data directory, to start again on the same database. */
  dataDir?: string;
  webRoot?: string;
}

export interface TestServer {
  request(path: string, init?: RequestInit): Promise<Response>;
  clock: FakeClock;
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
  const server = await assembleServer({
    clock,
    databaseFile,
    backupDir,
    log: (line) => logs.push(line),
    webRoot: options.webRoot,
  });
  let closed = false;

  return {
    request: async (path, init) =>
      server.app.request(`http://localhost${path}`, init),
    clock,
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
