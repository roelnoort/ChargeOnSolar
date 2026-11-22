// The storage module's single public entry. The database driver and the ORM
// stay behind it: everything it exposes takes and returns domain types.
import { mkdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { and, asc, desc, gte, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Clock } from "../clock.ts";
import type { P1Reading } from "../domain/p1-reading.ts";
import type { Startup } from "../domain/startup.ts";
import * as schema from "./schema.ts";

export interface Storage {
  recordStartup(startup: Startup): Promise<void>;
  latestStartup(): Promise<Startup | undefined>;
  recordP1Reading(reading: P1Reading): Promise<void>;
  /** P1 Readings received in `[from, to)`, oldest first, at most `limit`. */
  listP1Readings(window: ReadingWindow): Promise<P1Reading[]>;
  close(): Promise<void>;
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
    async close() {
      sqlite.close();
    },
  };
}

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
