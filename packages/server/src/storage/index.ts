// The storage module's single public entry. The database driver and the ORM
// stay behind it: everything it exposes takes and returns domain types.
import { mkdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OverrideCommand } from "@charge-on-solar/shared";
import Database from "better-sqlite3";
import { and, asc, count, desc, eq, gt, gte, isNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Clock } from "../clock.ts";
import {
  type ChargerReading,
  toPhaseSetting,
} from "../domain/charger-reading.ts";
import type { NewLoginCode } from "../domain/login-code.ts";
import type {
  CommandResult,
  ManualOverrideRecord,
  OpenPause,
  PauseEnding,
  PauseRecord,
} from "../domain/override.ts";
import type { P1Reading } from "../domain/p1-reading.ts";
import type {
  NewSignedInDevice,
  SignedInDevice,
  SignedInDeviceOfUser,
} from "../domain/signed-in-device.ts";
import type { Startup } from "../domain/startup.ts";
import type { NewUser, User } from "../domain/user.ts";
import * as schema from "./schema.ts";

export interface Storage {
  recordStartup(startup: Startup): Promise<void>;
  latestStartup(): Promise<Startup | undefined>;
  recordP1Reading(reading: P1Reading): Promise<void>;
  /** P1 Readings received in `[from, to)`, oldest first, at most `limit`. */
  listP1Readings(window: ReadingWindow): Promise<P1Reading[]>;
  recordChargerReading(reading: ChargerReading): Promise<void>;
  /** Charger Readings received in `[from, to)`, oldest first, at most `limit`. */
  listChargerReadings(window: ReadingWindow): Promise<ChargerReading[]>;

  /** Adds a User, or answers undefined when one already has this email. */
  addUser(user: NewUser & { at: Date }): Promise<User | undefined>;
  /** Removes a User with their codes and Signed-in devices. */
  removeUser(email: string): Promise<User | undefined>;
  listUsers(): Promise<User[]>;
  findUserByEmail(email: string): Promise<User | undefined>;

  /**
   * Records a request for a Login code, unless the address already made
   * `limit.requests` of them after `limit.after`: then false, and nothing is
   * recorded. One step, so requests arriving together cannot pass the limit.
   */
  recordLoginCodeRequest(
    email: string,
    at: Date,
    limit: { requests: number; after: Date }
  ): Promise<boolean>;
  /** Saves a new Login code and retires the User's earlier ones. */
  saveLoginCode(code: NewLoginCode): Promise<void>;
  /**
   * Tries the User's live Login code in one step, so two requests arriving
   * together cannot both use it or slip past the cap. When `matches` accepts
   * its hash, retires the code and signs the device in; otherwise counts a
   * wrong attempt, retiring the code once it reaches the cap.
   */
  redeemLoginCode(
    attempt: {
      matches: (codeHash: string) => boolean;
      wrongAttemptCap: number;
    },
    device: NewSignedInDevice
  ): Promise<SignedInDevice | undefined>;

  findSignedInDevice(
    tokenHash: string
  ): Promise<SignedInDeviceOfUser | undefined>;
  touchSignedInDevice(id: number, at: Date): Promise<void>;
  /** The User's devices last used after `usedAfter`, most recent first. */
  listSignedInDevices(
    userId: number,
    usedAfter: Date
  ): Promise<SignedInDevice[]>;
  /** Signs out one of the User's devices; false when they have no such device. */
  removeSignedInDevice(userId: number, id: number): Promise<boolean>;
  removeAllSignedInDevices(userId: number): Promise<void>;

  /** Records a Manual override as it is sent, and answers its id. */
  recordManualOverride(override: NewManualOverride): Promise<number>;
  recordCommandResult(overrideId: number, result: CommandResult): Promise<void>;
  /** Marks a Pause confirmed and opens the pause it made, in one step. */
  confirmPause(overrideId: number, at: Date): Promise<OpenPause>;
  /** Marks a Resume confirmed and ends the pause it answers, in one step. */
  confirmResume(
    overrideId: number,
    pauseId: number | null,
    at: Date
  ): Promise<void>;
  recordUnconfirmed(overrideId: number): Promise<void>;
  /** The most recent Manual overrides, newest first. */
  listManualOverrides(limit: number): Promise<ManualOverrideRecord[]>;

  openExternalPause(at: Date): Promise<OpenPause>;
  closePause(pauseId: number, at: Date, ending: PauseEnding): Promise<void>;
  findOpenPause(): Promise<OpenPause | undefined>;
  /** The most recent pauses, open or ended, newest first. */
  listPauses(limit: number): Promise<PauseRecord[]>;
  close(): Promise<void>;
}

export interface NewManualOverride {
  sentAt: Date;
  user: { id: number; name: string };
  command: OverrideCommand;
  answersPauseId: number | null;
}

export interface ReadingWindow {
  from: Date;
  to: Date;
  limit: number;
}

export interface OpenStorageOptions {
  databaseFile: string;
  /** Where the backup taken before migrating is written. */
  backupDir: string;
  clock: Clock;
  log: (line: string) => void;
}

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url)
);

export async function openStorage(
  options: OpenStorageOptions
): Promise<Storage> {
  const sqlite = new Database(options.databaseFile);
  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    backUp(sqlite, options);
    const db = drizzle({ client: sqlite, schema });
    const before = appliedMigrationTimes(sqlite);
    migrate(db, { migrationsFolder });
    logAppliedMigrations(before, appliedMigrationTimes(sqlite), options.log);
    return storageOn(db, sqlite);
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

function storageOn(
  db: ReturnType<typeof drizzle<typeof schema>>,
  sqlite: Database.Database
): Storage {
  return {
    async recordStartup(startup) {
      db.insert(schema.startups).values(startup).run();
    },
    async latestStartup() {
      const row = db
        .select({ at: schema.startups.at, version: schema.startups.version })
        .from(schema.startups)
        .orderBy(desc(schema.startups.id))
        .limit(1)
        .get();
      return row;
    },
    async recordP1Reading(reading) {
      db.insert(schema.p1Readings).values(toP1Row(reading)).run();
    },
    async listP1Readings({ from, to, limit }) {
      const received = schema.p1Readings.receivedAt;
      return db
        .select()
        .from(schema.p1Readings)
        .where(and(gte(received, from), lt(received, to)))
        .orderBy(asc(received), asc(schema.p1Readings.id))
        .limit(limit)
        .all()
        .map(fromP1Row);
    },
    async recordChargerReading(reading) {
      db.insert(schema.chargerReadings).values(toChargerRow(reading)).run();
    },
    async listChargerReadings({ from, to, limit }) {
      const received = schema.chargerReadings.receivedAt;
      return db
        .select()
        .from(schema.chargerReadings)
        .where(and(gte(received, from), lt(received, to)))
        .orderBy(asc(received), asc(schema.chargerReadings.id))
        .limit(limit)
        .all()
        .map(fromChargerRow);
    },

    async addUser({ name, email, at }) {
      return db
        .insert(schema.users)
        .values({ name, email, createdAt: at })
        .onConflictDoNothing()
        .returning(userColumns)
        .get();
    },
    async removeUser(email) {
      return db
        .delete(schema.users)
        .where(eq(schema.users.email, email))
        .returning(userColumns)
        .get();
    },
    async listUsers() {
      return db
        .select(userColumns)
        .from(schema.users)
        .orderBy(schema.users.name)
        .all();
    },
    async findUserByEmail(email) {
      return db
        .select(userColumns)
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .get();
    },

    async recordLoginCodeRequest(email, at, limit) {
      return db.transaction((tx) => {
        const recent = tx
          .select({ requests: count() })
          .from(schema.loginCodeRequests)
          .where(
            and(
              eq(schema.loginCodeRequests.email, email),
              gt(schema.loginCodeRequests.at, limit.after)
            )
          )
          .get();
        if ((recent?.requests ?? 0) >= limit.requests) return false;
        tx.insert(schema.loginCodeRequests).values({ email, at }).run();
        return true;
      });
    },
    async saveLoginCode({ userId, codeHash, createdAt, expiresAt }) {
      db.transaction((tx) => {
        tx.update(schema.loginCodes)
          .set({ retiredAt: createdAt })
          .where(
            and(
              eq(schema.loginCodes.userId, userId),
              isNull(schema.loginCodes.retiredAt)
            )
          )
          .run();
        tx.insert(schema.loginCodes)
          .values({ userId, codeHash, expiresAt })
          .run();
      });
    },
    async redeemLoginCode(
      { matches, wrongAttemptCap },
      { userId, tokenHash, deviceName, at }
    ) {
      return db.transaction((tx) => {
        const live = tx
          .select({
            id: schema.loginCodes.id,
            codeHash: schema.loginCodes.codeHash,
            wrongAttempts: schema.loginCodes.wrongAttempts,
          })
          .from(schema.loginCodes)
          .where(
            and(
              eq(schema.loginCodes.userId, userId),
              isNull(schema.loginCodes.retiredAt),
              gt(schema.loginCodes.expiresAt, at)
            )
          )
          .orderBy(desc(schema.loginCodes.id))
          .get();
        if (!live) return undefined;
        if (!matches(live.codeHash)) {
          const wrongAttempts = live.wrongAttempts + 1;
          tx.update(schema.loginCodes)
            .set({
              wrongAttempts,
              retiredAt: wrongAttempts >= wrongAttemptCap ? at : null,
            })
            .where(eq(schema.loginCodes.id, live.id))
            .run();
          return undefined;
        }
        tx.update(schema.loginCodes)
          .set({ retiredAt: at })
          .where(eq(schema.loginCodes.id, live.id))
          .run();
        return tx
          .insert(schema.sessions)
          .values({
            userId,
            tokenHash,
            deviceName,
            createdAt: at,
            lastUsedAt: at,
          })
          .returning(deviceColumns)
          .get();
      });
    },

    async findSignedInDevice(tokenHash) {
      return db
        .select({ device: deviceColumns, user: userColumns })
        .from(schema.sessions)
        .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
        .where(eq(schema.sessions.tokenHash, tokenHash))
        .get();
    },
    async touchSignedInDevice(id, at) {
      db.update(schema.sessions)
        .set({ lastUsedAt: at })
        .where(eq(schema.sessions.id, id))
        .run();
    },
    async listSignedInDevices(userId, usedAfter) {
      return db
        .select(deviceColumns)
        .from(schema.sessions)
        .where(
          and(
            eq(schema.sessions.userId, userId),
            gt(schema.sessions.lastUsedAt, usedAfter)
          )
        )
        .orderBy(desc(schema.sessions.lastUsedAt))
        .all();
    },
    async removeSignedInDevice(userId, id) {
      const removed = db
        .delete(schema.sessions)
        .where(
          and(eq(schema.sessions.userId, userId), eq(schema.sessions.id, id))
        )
        .returning({ id: schema.sessions.id })
        .get();
      return removed !== undefined;
    },
    async removeAllSignedInDevices(userId) {
      db.delete(schema.sessions)
        .where(eq(schema.sessions.userId, userId))
        .run();
    },

    async recordManualOverride({ sentAt, user, command, answersPauseId }) {
      const row = db
        .insert(schema.manualOverrides)
        .values({
          sentAt,
          userId: user.id,
          userName: user.name,
          command,
          answersPauseId,
        })
        .returning({ id: schema.manualOverrides.id })
        .get();
      return row.id;
    },
    async recordCommandResult(overrideId, result) {
      db.update(schema.manualOverrides)
        .set(
          result.accepted
            ? { commandResult: "accepted" }
            : {
                commandResult: "rejected",
                rejectionCode: result.code,
                rejectionReason: result.reason,
              }
        )
        .where(eq(schema.manualOverrides.id, overrideId))
        .run();
    },
    async confirmPause(overrideId, at) {
      return db.transaction((tx) => {
        tx.update(schema.manualOverrides)
          .set({ confirmation: "confirmed" })
          .where(eq(schema.manualOverrides.id, overrideId))
          .run();
        return tx
          .insert(schema.pauses)
          .values({ source: "chargeonsolar", overrideId, startedAt: at })
          .returning(openPauseColumns)
          .get();
      });
    },
    async confirmResume(overrideId, pauseId, at) {
      db.transaction((tx) => {
        tx.update(schema.manualOverrides)
          .set({ confirmation: "confirmed" })
          .where(eq(schema.manualOverrides.id, overrideId))
          .run();
        if (pauseId === null) return;
        tx.update(schema.pauses)
          .set({ endedAt: at, ending: "resumed-by-chargeonsolar" })
          .where(
            and(eq(schema.pauses.id, pauseId), isNull(schema.pauses.endedAt))
          )
          .run();
      });
    },
    async recordUnconfirmed(overrideId) {
      db.update(schema.manualOverrides)
        .set({ confirmation: "unconfirmed" })
        .where(eq(schema.manualOverrides.id, overrideId))
        .run();
    },
    async listManualOverrides(limit) {
      return db
        .select()
        .from(schema.manualOverrides)
        .orderBy(desc(schema.manualOverrides.id))
        .limit(limit)
        .all()
        .map(fromManualOverrideRow);
    },

    async openExternalPause(at) {
      return db
        .insert(schema.pauses)
        .values({ source: "external", startedAt: at })
        .returning(openPauseColumns)
        .get();
    },
    async closePause(pauseId, at, ending) {
      db.update(schema.pauses)
        .set({ endedAt: at, ending })
        .where(eq(schema.pauses.id, pauseId))
        .run();
    },
    async findOpenPause() {
      return db
        .select(openPauseColumns)
        .from(schema.pauses)
        .where(isNull(schema.pauses.endedAt))
        .orderBy(desc(schema.pauses.id))
        .get();
    },
    async listPauses(limit) {
      return db
        .select({
          ...openPauseColumns,
          overrideId: schema.pauses.overrideId,
          endedAt: schema.pauses.endedAt,
          ending: schema.pauses.ending,
        })
        .from(schema.pauses)
        .orderBy(desc(schema.pauses.id))
        .limit(limit)
        .all();
    },

    async close() {
      sqlite.close();
    },
  };
}

const openPauseColumns = {
  id: schema.pauses.id,
  source: schema.pauses.source,
  startedAt: schema.pauses.startedAt,
};

function fromManualOverrideRow({
  commandResult,
  rejectionCode,
  rejectionReason,
  ...row
}: typeof schema.manualOverrides.$inferSelect): ManualOverrideRecord {
  return {
    ...row,
    commandResult:
      commandResult === null
        ? null
        : commandResult === "accepted"
          ? { accepted: true }
          : {
              accepted: false,
              code: rejectionCode,
              reason: rejectionReason ?? "",
            },
  };
}

const userColumns = {
  id: schema.users.id,
  name: schema.users.name,
  email: schema.users.email,
};

const deviceColumns = {
  id: schema.sessions.id,
  userId: schema.sessions.userId,
  deviceName: schema.sessions.deviceName,
  signedInAt: schema.sessions.createdAt,
  lastUsedAt: schema.sessions.lastUsedAt,
};

type P1Row = typeof schema.p1Readings.$inferSelect;

function toP1Row({
  receivedAt,
  deviceTimestamp,
  netPowerW,
  phases: { l1, l2, l3 },
}: P1Reading): Omit<P1Row, "id"> {
  return {
    receivedAt,
    deviceTimestamp,
    netPowerW,
    powerL1W: l1.powerW,
    powerL2W: l2.powerW,
    powerL3W: l3.powerW,
    currentL1A: l1.currentA,
    currentL2A: l2.currentA,
    currentL3A: l3.currentA,
    voltageL1V: l1.voltageV,
    voltageL2V: l2.voltageV,
    voltageL3V: l3.voltageV,
  };
}

function fromP1Row(row: P1Row): P1Reading {
  return {
    receivedAt: row.receivedAt,
    deviceTimestamp: row.deviceTimestamp,
    netPowerW: row.netPowerW,
    phases: {
      l1: {
        powerW: row.powerL1W,
        currentA: row.currentL1A,
        voltageV: row.voltageL1V,
      },
      l2: {
        powerW: row.powerL2W,
        currentA: row.currentL2A,
        voltageV: row.voltageL2V,
      },
      l3: {
        powerW: row.powerL3W,
        currentA: row.currentL3A,
        voltageV: row.voltageL3V,
      },
    },
  };
}

type ChargerRow = typeof schema.chargerReadings.$inferSelect;

function toChargerRow({
  phaseCurrentsA,
  ...reading
}: ChargerReading): Omit<ChargerRow, "id"> {
  return {
    ...reading,
    currentL1A: phaseCurrentsA.l1,
    currentL2A: phaseCurrentsA.l2,
    currentL3A: phaseCurrentsA.l3,
  };
}

function fromChargerRow({
  id: _id,
  currentL1A,
  currentL2A,
  currentL3A,
  phaseSetting: storedPhaseSetting,
  ...row
}: ChargerRow): ChargerReading {
  return {
    ...row,
    phaseSetting: toPhaseSetting(storedPhaseSetting),
    phaseCurrentsA: { l1: currentL1A, l2: currentL2A, l3: currentL3A },
  };
}

function backUp(sqlite: Database.Database, options: OpenStorageOptions) {
  mkdirSync(options.backupDir, { recursive: true });
  const extension = extname(options.databaseFile);
  const stamp = options.clock.now().toISOString().replaceAll(":", "-");
  const file = join(
    options.backupDir,
    `${basename(options.databaseFile, extension)}-${stamp}${extension}`
  );
  sqlite.prepare("VACUUM INTO ?").run(file);
  options.log(`Backup written to ${file}`);
}

/** The `created_at` of each migration Drizzle has recorded as applied. */
function appliedMigrationTimes(sqlite: Database.Database): Set<number> {
  const table = sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'"
    )
    .get();
  if (!table) return new Set();
  const rows = sqlite
    .prepare("SELECT created_at FROM __drizzle_migrations")
    .all() as { created_at: number }[];
  return new Set(rows.map((row) => Number(row.created_at)));
}

interface Journal {
  entries: { tag: string; when: number }[];
}

function logAppliedMigrations(
  before: Set<number>,
  after: Set<number>,
  log: (line: string) => void
) {
  const journal: Journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8")
  );
  const applied = journal.entries.filter(
    (entry) => after.has(entry.when) && !before.has(entry.when)
  );
  if (applied.length === 0) log("No pending migrations");
  for (const entry of applied) log(`Applied migration ${entry.tag}`);
}
