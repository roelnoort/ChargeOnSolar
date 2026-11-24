import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = path.join(import.meta.dirname, "backup.sh");

let dir: string;
let database: string;
let envFile: string;
let backupDir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-"));
  fs.mkdirSync(path.join(dir, "data"));
  database = path.join(dir, "data", "chargeonsolar.db");
  envFile = path.join(dir, ".env");
  backupDir = path.join(dir, "backup", "chargeonsolar");
  fs.writeFileSync(envFile, "ENPHASE_TOKEN_KEY=secret\n");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function createDatabase(rows: string[]) {
  const db = new DatabaseSync(database);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE readings (id INTEGER PRIMARY KEY, label TEXT)");
  const insert = db.prepare("INSERT INTO readings (label) VALUES (?)");
  for (const row of rows) insert.run(row);
  return db;
}

function labelsIn(file: string): string[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db
      .prepare("SELECT label FROM readings ORDER BY id")
      .all()
      .map((row) => String(row.label));
  } finally {
    db.close();
  }
}

function rowCount(file: string): number {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare("SELECT count(*) AS n FROM readings").get();
    return Number(row?.n);
  } finally {
    db.close();
  }
}

function totalIn(file: string): number {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return Number(db.prepare("SELECT rows FROM totals").get()?.rows);
  } finally {
    db.close();
  }
}

/**
 * Another process that commits until it is killed. Each commit adds a Reading
 * and updates the total, so in a consistent copy the two always agree.
 */
function startWriter() {
  const program = `
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1]);
    db.exec("PRAGMA busy_timeout = 5000");
    const insert = db.prepare("INSERT INTO readings (label) VALUES ('x')");
    const total = db.prepare("UPDATE totals SET rows = rows + 1");
    for (;;) {
      db.exec("BEGIN IMMEDIATE");
      insert.run();
      total.run();
      db.exec("COMMIT");
    }
  `;
  return spawn(process.execPath, ["-e", program, database], {
    stdio: "ignore",
  });
}

async function until(condition: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Every date from `first` to `last`, both included, as YYYY-MM-DD. */
function datesFrom(first: string, last: string): string[] {
  const dates: string[] = [];
  for (
    let day = new Date(`${first}T00:00:00Z`);
    day <= new Date(`${last}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}

/** Decompresses a backup into the temporary folder and returns its path. */
function restore(backup: string): string {
  const restored = path.join(dir, `restored-${path.basename(backup, ".gz")}`);
  fs.writeFileSync(restored, gunzipSync(fs.readFileSync(backup)));
  return restored;
}

/** The files in the backup folder, sorted. */
function backups(): string[] {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir).sort();
}

type Result = { code: number | null; output: string };

function backUp(today: string, env: Record<string, string> = {}) {
  return new Promise<Result>((resolve, reject) => {
    const child = spawn("bash", [script], {
      env: {
        PATH: process.env.PATH,
        BACKUP_DATABASE: database,
        BACKUP_ENV_FILE: envFile,
        BACKUP_DIR: backupDir,
        BACKUP_TODAY: today,
        ...env,
      },
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

describe("backup", () => {
  it("writes a compressed backup, named by date, with the same rows", async () => {
    createDatabase(["first", "second", "third"]).close();

    const result = await backUp("2026-11-24");

    expect(result.code).toBe(0);
    const backup = path.join(backupDir, "chargeonsolar-2026-11-24.db.gz");
    expect(labelsIn(restore(backup))).toEqual(["first", "second", "third"]);
  });

  it("copies .env alongside the backup", async () => {
    createDatabase(["first"]).close();

    const result = await backUp("2026-11-24");

    expect(result.code).toBe(0);
    const copy = path.join(backupDir, "chargeonsolar-2026-11-24.env");
    expect(fs.readFileSync(copy, "utf8")).toBe("ENPHASE_TOKEN_KEY=secret\n");
  });

  it("makes the backup and the .env copy readable only by their owner", async () => {
    createDatabase(["first"]).close();
    fs.chmodSync(envFile, 0o644);

    const result = await backUp("2026-11-24");

    expect(result.code).toBe(0);
    const mode = (file: string) =>
      fs.statSync(path.join(backupDir, file)).mode & 0o777;
    expect(mode("chargeonsolar-2026-11-24.db.gz")).toBe(0o600);
    expect(mode("chargeonsolar-2026-11-24.env")).toBe(0o600);
  });

  it("makes a consistent backup while the database is being written to", async () => {
    const db = createDatabase([]);
    db.exec("CREATE TABLE totals (rows INTEGER NOT NULL)");
    db.exec("INSERT INTO totals (rows) VALUES (0)");
    db.close();
    const writer = startWriter();
    try {
      await until(() => rowCount(database) > 200);

      const result = await backUp("2026-11-24");

      expect(result.code).toBe(0);
      const restored = restore(
        path.join(backupDir, "chargeonsolar-2026-11-24.db.gz")
      );
      const counted = rowCount(restored);
      expect(counted).toBeGreaterThan(200);
      expect(totalIn(restored)).toBe(counted);
    } finally {
      writer.kill();
    }
  });

  it("keeps the 14 latest backups and the first of each month for 12 months", async () => {
    createDatabase(["first"]).close();
    fs.mkdirSync(backupDir, { recursive: true });
    const missing = ["2026-03-01", "2026-03-02"];
    for (const date of datesFrom("2024-11-01", "2026-11-23")) {
      if (missing.includes(date)) continue;
      fs.writeFileSync(path.join(backupDir, `chargeonsolar-${date}.db.gz`), "");
      fs.writeFileSync(path.join(backupDir, `chargeonsolar-${date}.env`), "");
    }
    fs.writeFileSync(path.join(backupDir, "notes.txt"), "mine");

    const result = await backUp("2026-11-24");

    expect(result.code).toBe(0);
    const kept = [
      // the first backup of each month, for the 12 months up to this one
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
      "2026-03-03",
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
      "2026-11-01",
      // the 14 latest
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
      "2026-11-23",
      "2026-11-24",
    ];
    expect(backups()).toEqual(
      [
        ...kept.flatMap((date) => [
          `chargeonsolar-${date}.db.gz`,
          `chargeonsolar-${date}.env`,
        ]),
        "notes.txt",
      ].sort()
    );
  });

  it("fails without creating a database when the database is missing", async () => {
    const result = await backUp("2026-11-24");

    expect(result.code).not.toBe(0);
    expect(result.output).toContain(`No database at ${database}`);
    expect(fs.existsSync(database)).toBe(false);
    expect(backups()).toEqual([]);
  });

  it("fails when the database file isn't a database", async () => {
    fs.writeFileSync(database, "not a database");

    const result = await backUp("2026-11-24");

    expect(result.code).not.toBe(0);
    expect(backups()).toEqual([]);
  });
});
