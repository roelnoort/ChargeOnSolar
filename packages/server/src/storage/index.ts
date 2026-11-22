// The storage module's single public entry. The database driver and the ORM
// stay behind it: everything it exposes takes and returns domain types.
import { mkdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { and, count, desc, eq, gt, gte, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Clock } from "../clock.ts";
import type { NewLoginCode, StoredLoginCode } from "../domain/login-code.ts";
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

  /** Adds a User, or answers undefined when one already has this email. */
  addUser(user: NewUser & { at: Date }): Promise<User | undefined>;
  /** Removes a User with their codes and Signed-in devices. */
  removeUser(email: string): Promise<User | undefined>;
  listUsers(): Promise<User[]>;
  findUserByEmail(email: string): Promise<User | undefined>;

  recordLoginCodeRequest(email: string, at: Date): Promise<void>;
  countLoginCodeRequestsSince(email: string, since: Date): Promise<number>;
  /** Saves a new Login code and retires the User's earlier ones. */
  saveLoginCode(code: NewLoginCode): Promise<void>;
  findLiveLoginCode(
    userId: number,
    now: Date
  ): Promise<StoredLoginCode | undefined>;
  /** Counts a wrong attempt, retiring the code once it reaches the cap. */
  recordWrongAttempt(codeId: number, cap: number, at: Date): Promise<void>;
  /** Retires the code and signs the device in, both or neither. */
  redeemLoginCode(
    codeId: number,
    device: NewSignedInDevice
  ): Promise<SignedInDevice>;

  findSignedInDevice(
    tokenHash: string
  ): Promise<SignedInDeviceOfUser | undefined>;
  touchSignedInDevice(id: number, at: Date): Promise<void>;
  listSignedInDevices(userId: number): Promise<SignedInDevice[]>;
  /** Signs out one of the User's devices; false when they have no such device. */
  removeSignedInDevice(userId: number, id: number): Promise<boolean>;
  removeAllSignedInDevices(userId: number): Promise<void>;
  close(): Promise<void>;
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

    async recordLoginCodeRequest(email, at) {
      db.insert(schema.loginCodeRequests).values({ email, at }).run();
    },
    async countLoginCodeRequestsSince(email, since) {
      const row = db
        .select({ requests: count() })
        .from(schema.loginCodeRequests)
        .where(
          and(
            eq(schema.loginCodeRequests.email, email),
            gte(schema.loginCodeRequests.at, since)
          )
        )
        .get();
      return row?.requests ?? 0;
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
    async findLiveLoginCode(userId, now) {
      return db
        .select({
          id: schema.loginCodes.id,
          userId: schema.loginCodes.userId,
          codeHash: schema.loginCodes.codeHash,
          expiresAt: schema.loginCodes.expiresAt,
          wrongAttempts: schema.loginCodes.wrongAttempts,
        })
        .from(schema.loginCodes)
        .where(
          and(
            eq(schema.loginCodes.userId, userId),
            isNull(schema.loginCodes.retiredAt),
            gt(schema.loginCodes.expiresAt, now)
          )
        )
        .orderBy(desc(schema.loginCodes.id))
        .get();
    },
    async recordWrongAttempt(codeId, cap, at) {
      db.transaction((tx) => {
        tx.update(schema.loginCodes)
          .set({ wrongAttempts: sql`${schema.loginCodes.wrongAttempts} + 1` })
          .where(eq(schema.loginCodes.id, codeId))
          .run();
        tx.update(schema.loginCodes)
          .set({ retiredAt: at })
          .where(
            and(
              eq(schema.loginCodes.id, codeId),
              gte(schema.loginCodes.wrongAttempts, cap)
            )
          )
          .run();
      });
    },
    async redeemLoginCode(codeId, { userId, tokenHash, deviceName, at }) {
      return db.transaction((tx) => {
        tx.update(schema.loginCodes)
          .set({ retiredAt: at })
          .where(eq(schema.loginCodes.id, codeId))
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
    async listSignedInDevices(userId) {
      return db
        .select(deviceColumns)
        .from(schema.sessions)
        .where(eq(schema.sessions.userId, userId))
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

    async close() {
      sqlite.close();
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
