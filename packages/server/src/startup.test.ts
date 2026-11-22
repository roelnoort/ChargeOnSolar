import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./testing/harness.ts";

let dataDir: string;
const servers: TestServer[] = [];

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "startup-"));
});
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function logsOfStartOn(backup: string) {
  const restoredDir = await mkdtemp(join(tmpdir(), "restored-"));
  try {
    await copyFile(backup, join(restoredDir, "chargeonsolar.db"));
    const restored = await startTestServer({ dataDir: restoredDir });
    await restored.close();
    return restored.logs;
  } finally {
    await rm(restoredDir, { recursive: true, force: true });
  }
}

async function start(now: string) {
  const server = await startTestServer({ dataDir, now: new Date(now) });
  servers.push(server);
  return server;
}

describe("startup", () => {
  it("writes a backup, then applies the pending migrations, and logs them", async () => {
    const server = await start("2026-06-01T08:00:00.000Z");

    const backups = await readdir(server.backupDir);
    expect(backups).toHaveLength(1);
    const backupLine = server.logs.findIndex((line) =>
      line.includes("Backup written")
    );
    const migrationLine = server.logs.findIndex((line) =>
      line.includes("Applied migration 0000_")
    );
    expect(backupLine).toBeGreaterThanOrEqual(0);
    expect(migrationLine).toBeGreaterThan(backupLine);
  });

  it("applies no migrations the second time, and still writes a backup", async () => {
    const first = await start("2026-06-01T08:00:00.000Z");
    await first.close();

    const second = await start("2026-06-02T08:00:00.000Z");

    expect(second.logs).toContain("No pending migrations");
    expect(await readdir(second.backupDir)).toHaveLength(2);
  });

  it("backs up the database as it was before this start", async () => {
    const first = await start("2026-06-01T08:00:00.000Z");
    await first.close();
    const second = await start("2026-06-02T08:00:00.000Z");
    await second.close();
    const [beforeFirst, beforeSecond] = (
      await readdir(second.backupDir)
    ).sort();

    // The backup taken before the first start predates every migration; the
    // one taken before the second start already has them all.
    expect(
      await logsOfStartOn(join(second.backupDir, beforeFirst ?? ""))
    ).toContainEqual(expect.stringContaining("Applied migration 0000_"));
    expect(
      await logsOfStartOn(join(second.backupDir, beforeSecond ?? ""))
    ).toContain("No pending migrations");
  });

  it("runs SQLite in WAL mode", async () => {
    const server = await start("2026-06-01T08:00:00.000Z");

    expect(existsSync(`${server.databaseFile}-wal`)).toBe(true);
  });
});
