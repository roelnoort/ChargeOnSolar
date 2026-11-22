import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  csrfHeader,
  type Settings,
  settings,
  settingsPath,
  shadowDecisionList,
  shadowDecisionsPath,
} from "@charge-on-solar/shared";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import {
  startTestServer,
  type TestServer,
  type TestServerOptions,
} from "../testing/harness.ts";

const minute = 60_000;
const t0 = new Date("2026-06-01T12:00:00.000Z");

const defaults: Settings = {
  solarMode: "solar-only",
  startWindowMinutes: 5,
  stopWindowMinutes: 10,
  minimumOnTimeMinutes: 15,
  minimumOffTimeMinutes: 15,
  currentHoldMinutes: 15,
  deadBandAmps: 1,
  voltage: 230,
  mainFuseAmps: 25,
  minimumSolarWatts: 0,
  tickIntervalSeconds: 60,
};

/** A Go 2 on 1 phase, up to 16 A, with a car plugged in and asking for charge. */
const carPluggedIn = {
  operationMode: 2,
  chargerPowerW: 0,
  phaseSetting: 1,
  maxCurrentA: 16,
  phaseCurrentsA: { l1: 0, l2: 0, l3: 0 },
  availableCurrentMode: 2,
} as const;

/** Exporting: the P1 meter reports current without a sign; the power has it. */
function exporting(watts: number) {
  return {
    netPowerW: -watts,
    phases: {
      l1: { powerW: -watts, currentA: watts / 230, voltageV: 230 },
    },
  };
}

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start(options: TestServerOptions = {}) {
  server = await startTestServer({ now: t0, ...options });
  return server;
}

function putSettings(body: unknown) {
  return server?.requestSignedIn(settingsPath, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      [csrfHeader.name]: csrfHeader.value,
    },
    body: JSON.stringify(body),
  });
}

async function changeSettings(changes: Partial<Settings>) {
  const response = await putSettings({ ...(await readSettings()), ...changes });
  expect(response?.status).toBe(200);
}

async function decisions() {
  const query = new URLSearchParams({
    from: t0.toISOString(),
    to: new Date(t0.getTime() + 24 * 60 * minute).toISOString(),
  });
  const response = await server?.requestSignedIn(
    `${shadowDecisionsPath}?${query}`
  );
  expect(response?.status).toBe(200);
  return shadowDecisionList.parse(await response?.json()).decisions;
}

async function readSettings() {
  const response = await server?.requestSignedIn(settingsPath);
  expect(response?.status).toBe(200);
  return settings.parse(await response?.json());
}

describe("Settings", () => {
  it("start from the defaults, with the main fuse the server was given", async () => {
    await start({ mainFuseA: 35 });

    expect(await readSettings()).toEqual({
      solarMode: "solar-only",
      startWindowMinutes: 5,
      stopWindowMinutes: 10,
      minimumOnTimeMinutes: 15,
      minimumOffTimeMinutes: 15,
      currentHoldMinutes: 15,
      deadBandAmps: 1,
      voltage: 230,
      mainFuseAmps: 35,
      minimumSolarWatts: 0,
      tickIntervalSeconds: 60,
    });
  });

  it("read back as they were updated", async () => {
    await start();
    const changed: Settings = {
      ...defaults,
      solarMode: "all-solar",
      startWindowMinutes: 3,
      deadBandAmps: 0.5,
      minimumSolarWatts: 400,
      tickIntervalSeconds: 30,
    };

    const response = await putSettings(changed);

    expect(response?.status).toBe(200);
    expect(settings.parse(await response?.json())).toEqual(changed);
    expect(await readSettings()).toEqual(changed);
  });

  it("survive a restart", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "settings-restart-"));
    onTestFinished(() => rm(dataDir, { recursive: true, force: true }));
    await start({ dataDir });
    await changeSettings({ solarMode: "all-solar", mainFuseAmps: 40 });
    await server?.close();

    server = await startTestServer({
      now: new Date(t0.getTime() + minute),
      dataDir,
    });

    expect(await readSettings()).toMatchObject({
      solarMode: "all-solar",
      mainFuseAmps: 40,
    });
  });

  it.each([
    [
      { startWindowMinutes: 0 },
      "The start window must be a whole number of minutes from 1 to 60",
    ],
    [
      { minimumOffTimeMinutes: 7.5 },
      "The minimum off-time must be a whole number of minutes from 1 to 120",
    ],
    [{ solarMode: "boost" }, "Solar mode must be Solar only or All solar"],
    [
      { tickIntervalSeconds: "60" },
      "The tick interval must be a whole number of seconds from 10 to 600",
    ],
    [
      { voltage: undefined },
      "The voltage must be a whole number of volts from 200 to 250",
    ],
  ])("reject %o with a readable error", async (change, message) => {
    await start();

    const response = await putSettings({ ...defaults, ...change });

    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({
      error: { status: 400, message },
    });
    expect(await readSettings()).toEqual(defaults);
  });

  it("switch the next Shadow decision to All solar, and are stamped on it", async () => {
    const { p1, advance } = await start({ charger: carPluggedIn });
    // Below the 1380 W that 6 A on 1 phase needs.
    p1.send(exporting(1000));
    await advance(minute);

    await changeSettings({ solarMode: "all-solar" });
    await advance(minute);

    const [before, after] = await decisions();
    expect(before?.decision).toEqual({
      kind: "hold",
      reason: "surplus-too-low",
    });
    expect(before?.settings.solarMode).toBe("solar-only");
    expect(after?.decision).toEqual({
      kind: "start",
      currentAmps: 6,
      limitedBy: "minimum-current",
    });
    expect(after?.settings).toEqual({ ...defaults, solarMode: "all-solar" });
    expect(after?.rulesVersion).toBe(1);
  });

  it("do not cut short the current hold of a charge session under way", async () => {
    const { p1, advance } = await start({ charger: carPluggedIn });
    p1.send(exporting(3300));
    await advance(minute);

    await changeSettings({ solarMode: "all-solar" });
    p1.send(exporting(2300));
    await advance(minute);

    const [started, next] = await decisions();
    expect(started?.decision).toMatchObject({ kind: "start", currentAmps: 14 });
    expect(next?.decision).toEqual({ kind: "hold", reason: "current-hold" });
    expect(next?.chargingCurrentA).toBe(14);
  });

  it("change the tick interval from the next tick on", async () => {
    const { p1, advance } = await start({ charger: carPluggedIn });
    p1.send(exporting(3300));

    await changeSettings({ tickIntervalSeconds: 300 });
    await advance(11 * minute);

    expect((await decisions()).map(({ at }) => at)).toEqual([
      "2026-06-01T12:01:00.000Z",
      "2026-06-01T12:06:00.000Z",
      "2026-06-01T12:11:00.000Z",
    ]);
  });
});
