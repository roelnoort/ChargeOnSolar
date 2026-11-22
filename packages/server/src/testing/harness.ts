// The main test seam: the whole server put together in-process, on a
// temporary SQLite file with the real migrations, and a controllable clock.
// The P1 meter, the Zaptec cloud and the mailer are fakes the test drives; the
// fake mailer captures every Login code. Later slices plug the other fake
// vendor clients in here.
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
import type { Storage } from "../storage/index.ts";
import { runUsersCommand, type UsersCommandResult } from "../users-command.ts";
import { zaptecPollIntervalMs } from "../zaptec/collector.ts";
import { createFakeClock, type FakeClock } from "./fake-clock.ts";
import { createFakeMailer, type FakeMailer } from "./fake-mailer.ts";
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
  shadowTickMs?: number;
}

export interface TestServer {
  request(path: string, init?: RequestInit): Promise<Response>;
  clock: FakeClock;
  mailer: FakeMailer;
  addUser(user: NewUser): Promise<User>;
  /** Runs `pnpm users` with these arguments against this server's database. */
  usersCommand(args: string[]): Promise<UsersCommandResult>;
  /**
   * Logs a User in through the real flow, as a native client, and answers
   * the headers that carry its session.
   */
  signIn(email: string): Promise<{ authorization: string }>;
  /**
   * Requests `path` as a signed-in User, for tests about what a route answers
   * rather than about sessions. Adds and signs in a User on first use.
   */
  requestSignedIn(path: string, init?: RequestInit): Promise<Response>;
  /** The fake P1 meter the server collects from. */
  p1: FakeP1Client;
  /** The fake Zaptec cloud the server reads the charger from. */
  zaptec: FakeZaptecClient;
  /**
   * Moves the clock on, a poll interval by default, and waits for the Zaptec
   * read that comes due to be handled.
   */
  pollZaptec(milliseconds?: number): Promise<void>;
  /**
   * Moves the clock on a second at a time, letting everything that comes
   * due (Zaptec reads, Shadow runner ticks) finish before the next second.
   */
  advance(milliseconds: number): Promise<void>;
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
  const mailer = createFakeMailer();
  const { databaseFile, backupDir } = dataFiles(dataDir);
  const p1 = createFakeP1Client(clock);
  p1.unreachable = options.p1Unreachable ?? false;
  const zaptec = createFakeZaptecClient(clock);
  zaptec.unreachable = options.zaptecUnreachable ?? false;
  if (options.charger) zaptec.set(options.charger);
  const firstRead = zaptec.whenRead();
  const server = await assembleServer({
    clock,
    mailer,
    databaseFile,
    backupDir,
    log: (line) => logs.push(line),
    p1Client: p1,
    zaptecClient: zaptec,
    mainFuseA: options.mainFuseA,
    shadowTickMs: options.shadowTickMs,
    webRoot: options.webRoot,
  });
  if (!p1.unreachable) await p1.whenConnected();
  await firstRead;
  await settle();
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

  let signedIn: Promise<{ authorization: string }> | undefined;
  const testServer: TestServer = {
    request,
    clock,
    mailer,
    async addUser(user) {
      const added = await server.storage.addUser({ ...user, at: clock.now() });
      if (!added) throw new Error(`A User with ${user.email} already exists`);
      return added;
    },
    usersCommand: (args) =>
      runUsersCommand(args, { storage: server.storage, clock }),
    async signIn(email) {
      await post(loginCodePath, { email });
      const code = mailer.lastCodeFor(email);
      if (!code) throw new Error(`No Login code was sent to ${email}`);
      const response = await post(loginPath, { email, code, client: "native" });
      const { token } = loginResponse.parse(await response.json());
      return { authorization: `Bearer ${token}` };
    },
    async requestSignedIn(path, init) {
      signedIn ??= testServer
        .addUser({ name: "Test User", email: "test-user@example.com" })
        .then(() => testServer.signIn("test-user@example.com"));
      const headers = new Headers(init?.headers);
      headers.set("authorization", (await signedIn).authorization);
      return request(path, { ...init, headers });
    },
    p1,
    zaptec,
    async pollZaptec(milliseconds = zaptecPollIntervalMs) {
      const read = zaptec.whenRead();
      clock.advance(milliseconds);
      await read;
      await settle();
    },
    async advance(milliseconds) {
      for (let left = milliseconds; left > 0; left -= second) {
        clock.advance(Math.min(left, second));
        await settle();
      }
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
  return testServer;
}

const second = 1000;

/** Lets the promise callbacks already queued run, e.g. a collector's. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
