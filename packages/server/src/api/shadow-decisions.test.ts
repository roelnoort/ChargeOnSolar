import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  livePath,
  liveSnapshot,
  type ShadowDecisionRecord,
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

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

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

function importing(watts: number) {
  return {
    netPowerW: watts,
    phases: {
      l1: { powerW: watts, currentA: watts / 230, voltageV: 230 },
    },
  };
}

async function start(options: TestServerOptions = {}) {
  server = await startTestServer({ now: t0, ...options });
  return server;
}

async function decisions(
  from = t0,
  to = new Date(t0.getTime() + 24 * 60 * minute)
): Promise<ShadowDecisionRecord[]> {
  const query = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
  });
  const response = await server?.requestSignedIn(
    `${shadowDecisionsPath}?${query}`
  );
  expect(response?.status).toBe(200);
  return shadowDecisionList.parse(await response?.json()).decisions;
}

describe("Shadow decisions", () => {
  it("are 'No car' while the car is unplugged", async () => {
    const { p1, advance } = await start({
      charger: { ...carPluggedIn, operationMode: 1 },
    });
    p1.send(exporting(3300));

    await advance(minute);

    const [first, ...rest] = await decisions();
    expect(rest).toEqual([]);
    expect(first?.at).toBe("2026-06-01T12:01:00.000Z");
    expect(first?.decision).toEqual({ kind: "no-car" });
    expect(first?.chargingCurrentA).toBeNull();
  });

  it("start, change the Charging current and stop as the Surplus comes and goes", async () => {
    const { p1, advance } = await start({ charger: carPluggedIn });
    p1.send(exporting(3300));
    await advance(minute);
    p1.send(exporting(2300));
    await advance(15 * minute);
    p1.send(importing(500));
    await advance(9 * minute);

    const all = await decisions();
    expect(all).toHaveLength(25);
    const changes = all.filter(({ decision }) => decision.kind !== "hold");
    expect(changes.map(({ at, decision }) => ({ at, decision }))).toEqual([
      {
        at: "2026-06-01T12:01:00.000Z",
        decision: { kind: "start", currentAmps: 14, limitedBy: "surplus" },
      },
      {
        at: "2026-06-01T12:16:00.000Z",
        decision: {
          kind: "change-current",
          currentAmps: 10,
          limitedBy: "surplus",
        },
      },
      {
        // The 10-minute average drops below 6 A worth (1380 W) at 12:20.
        at: "2026-06-01T12:20:00.000Z",
        decision: { kind: "stop", reason: "surplus-too-low" },
      },
    ]);
    expect(all[1]?.decision).toEqual({ kind: "hold", reason: "current-hold" });
    expect(all[1]?.chargingCurrentA).toBe(14);
    expect(all.at(-1)?.chargingCurrentA).toBeNull();
  });

  it("record the minute's averaged inputs, Zaptec's own state and the stamped settings", async () => {
    const { p1, advance } = await start({
      charger: {
        ...carPluggedIn,
        chargingCurrentSetA: 13,
        enabledFeatures: 5,
        surplusModeActive: false,
      },
    });
    p1.send(exporting(3000));
    await advance(30_000);
    p1.send(exporting(2000));
    await advance(30_000);

    const [recorded] = await decisions();

    expect(recorded?.inputs).toEqual({
      surplusW: 2500,
      netPowerW: -2500,
      solarProductionW: null,
      chargerPowerW: 0,
      fuseHeadroomA: expect.closeTo(25 + 2500 / 230, 6),
      startWindowSurplusW: 2500,
      stopWindowSurplusW: 2500,
      // Zaptec was last read at 12:00:30.
      dataAgeMs: { p1: 30_000, charger: 30_000, solar: null },
    });
    expect(recorded?.zaptec).toEqual({
      availableCurrentMode: 2,
      enabledFeatures: 5,
      surplusModeActive: false,
      chargeCurrentSetA: 13,
    });
    expect(recorded?.rulesVersion).toBe(1);
    expect(recorded?.settings).toMatchObject({
      solarMode: "solar-only",
      mainFuseAmps: 25,
      startWindowMinutes: 5,
      stopWindowMinutes: 10,
    });
  });

  it("are paused, with what would happen without the pause, while the charger is paused", async () => {
    const { p1, advance } = await start({
      charger: { ...carPluggedIn, operationMode: 5, finalStopActive: true },
    });
    p1.send(exporting(3300));

    await advance(minute);

    expect((await decisions())[0]?.decision).toEqual({
      kind: "paused",
      underlying: { kind: "start", currentAmps: 14, limitedBy: "surplus" },
    });
  });

  it("wait for the data they need", async () => {
    const { advance, logs } = await start({ charger: carPluggedIn });

    await advance(2 * minute);

    expect(await decisions()).toEqual([]);
    expect(
      logs.filter((line) => line.startsWith("No Shadow decision"))
    ).toEqual(["No Shadow decision: the Fuse headroom is unknown"]);
  });

  it("carry the simulated charge session on across a restart", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "shadow-restart-"));
    onTestFinished(() => rm(dataDir, { recursive: true, force: true }));
    const { p1, advance } = await start({ dataDir, charger: carPluggedIn });
    p1.send(exporting(3300));
    await advance(minute);
    await server?.close();

    server = await startTestServer({
      now: new Date(t0.getTime() + 2 * minute),
      dataDir,
      charger: carPluggedIn,
    });
    server.p1.send(exporting(3300));
    await server.advance(minute);

    const all = await decisions();
    expect(all.map(({ decision }) => decision.kind)).toEqual(["start", "hold"]);
    expect(all[1]?.chargingCurrentA).toBe(14);
  });

  it("show the last one in the live snapshot straight after a restart", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "shadow-restart-"));
    onTestFinished(() => rm(dataDir, { recursive: true, force: true }));
    const { p1, advance } = await start({ dataDir, charger: carPluggedIn });
    p1.send(exporting(3300));
    await advance(minute);
    await server?.close();

    server = await startTestServer({
      now: new Date(t0.getTime() + 2 * minute),
      dataDir,
      charger: carPluggedIn,
    });
    const response = await server.requestSignedIn(livePath);
    const snapshot = liveSnapshot.parse(await response.json());

    expect(snapshot.shadowDecision?.at).toBe("2026-06-01T12:01:00.000Z");
    expect(snapshot.shadowDecision?.decision.kind).toBe("start");
  });

  it("are rejected without a time window", async () => {
    await start();

    const response = await server?.requestSignedIn(shadowDecisionsPath);

    expect(response?.status).toBe(400);
  });
});
