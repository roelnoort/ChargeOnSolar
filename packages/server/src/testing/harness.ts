// The main test seam: the whole server put together in-process, on a
// temporary SQLite file with the real migrations, and a controllable clock.
// The fake mailer captures every Login code. Later slices plug fake vendor
// clients in here.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  csrfHeader,
  loginCodePath,
  loginPath,
  loginResponse,
} from "@charge-on-solar/shared";
import type { NewUser, User } from "../domain/user.ts";
import { assembleServer, dataFiles } from "../server.ts";
import { createFakeClock, type FakeClock } from "./fake-clock.ts";
import { createFakeMailer, type FakeMailer } from "./fake-mailer.ts";

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
  mailer: FakeMailer;
  addUser(user: NewUser): Promise<User>;
  /**
   * Logs a User in through the real flow, as a native client, and answers
   * the headers that carry its session.
   */
  signIn(email: string): Promise<{ authorization: string }>;
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
  const mailer = createFakeMailer();
  const { databaseFile, backupDir } = dataFiles(dataDir);
  const server = await assembleServer({
    clock,
    mailer,
    databaseFile,
    backupDir,
    log: (line) => logs.push(line),
    webRoot: options.webRoot,
  });
  let closed = false;
  const request = async (path: string, init?: RequestInit) =>
    server.app.request(`http://localhost${path}`, init);
  const post = (path: string, body: unknown) =>
    request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [csrfHeader.name]: csrfHeader.value,
      },
      body: JSON.stringify(body),
    });

  return {
    request,
    clock,
    mailer,
    async addUser(user) {
      const added = await server.storage.addUser({ ...user, at: clock.now() });
      if (!added) throw new Error(`A User with ${user.email} already exists`);
      return added;
    },
    async signIn(email) {
      await post(loginCodePath, { email });
      const code = mailer.lastCodeFor(email);
      if (!code) throw new Error(`No Login code was sent to ${email}`);
      const response = await post(loginPath, { email, code, client: "native" });
      const { token } = loginResponse.parse(await response.json());
      return { authorization: `Bearer ${token}` };
    },
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
