import { livePath, liveSnapshot } from "@charge-on-solar/shared";
import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../testing/harness.ts";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function snapshot() {
  const response = await server?.requestSignedIn(livePath);
  expect(response?.status).toBe(200);
  return liveSnapshot.parse(await response?.json());
}

const importing = (currentA: number) => ({
  powerW: currentA * 230,
  currentA,
  voltageV: 230,
});

describe("the charger in GET /api/live", () => {
  it("is missing until Zaptec has been read, and so are Surplus and Fuse headroom", async () => {
    server = await startTestServer();
    server.p1.send({ netPowerW: 500 });

    const live = await snapshot();

    expect(live.charger).toBeNull();
    expect(live.surplusW).toBeNull();
    expect(live.fuseHeadroomA).toBeNull();
    expect(live.mainFuseA).toBe(25);
  });

  it("shows the charger's state, settings and when Zaptec was last read", async () => {
    server = await startTestServer({
      now: new Date("2026-06-01T12:00:00.000Z"),
      charger: {
        chargerPowerW: 2998.4,
        chargingCurrentSetA: 13,
        operationMode: 3,
        phaseSetting: 1,
        maxCurrentA: 32,
        phaseCurrentsA: { l1: 13, l2: 0, l3: 0 },
        availableCurrentMode: 2,
        surplusModeActive: false,
      },
    });

    expect((await snapshot()).charger).toEqual({
      lastSeenAt: "2026-06-01T12:00:00.000Z",
      reading: {
        chargerPowerW: 2998.4,
        chargingCurrentSetA: 13,
        state: "charging",
        nextScheduleEvent: null,
        phaseSetting: 1,
        maxCurrentA: 32,
        phaseCurrentsA: { l1: 13, l2: 0, l3: 0 },
        zaptecMode: "apm",
        apmActive: true,
        surplusModeActive: false,
      },
    });
  });

  it.each([
    [{ operationMode: 1 }, "disconnected"],
    [{ operationMode: 2 }, "connected"],
    [{ operationMode: 3 }, "charging"],
    [{ operationMode: 5, finalStopActive: true }, "paused"],
    [{ operationMode: 5, finalStopActive: false }, "finished"],
    [{ operationMode: null }, "unknown"],
  ] as const)("reads Zaptec state %o as %s", async (charger, state) => {
    server = await startTestServer({ charger });

    expect((await snapshot()).charger?.reading.state).toBe(state);
  });

  it("flags APM as off when Zaptec is in its Default mode", async () => {
    server = await startTestServer({ charger: { availableCurrentMode: 0 } });

    expect((await snapshot()).charger?.reading).toMatchObject({
      zaptecMode: "default",
      apmActive: false,
    });
  });

  it("flags APM as off when Zaptec follows a schedule", async () => {
    server = await startTestServer({ charger: { availableCurrentMode: 1 } });

    expect((await snapshot()).charger?.reading).toMatchObject({
      zaptecMode: "scheduled",
      apmActive: false,
    });
  });
});

describe("Surplus", () => {
  it("is Charger power minus Net power: exporting 1.2 kW while the car draws 3.0 kW is 4.2 kW", async () => {
    server = await startTestServer({ charger: { chargerPowerW: 3000 } });
    server.p1.send({ netPowerW: -1200 });

    expect((await snapshot()).surplusW).toBe(4200);
  });

  it("is negative when the house alone already imports", async () => {
    server = await startTestServer({ charger: { chargerPowerW: 0 } });
    server.p1.send({ netPowerW: 800 });

    expect((await snapshot()).surplusW).toBe(-800);
  });

  it("follows the newest Reading from each device", async () => {
    server = await startTestServer({ charger: { chargerPowerW: 3000 } });
    server.p1.send({ netPowerW: -1200 });
    server.zaptec.set({ chargerPowerW: 4100 });
    await server.pollZaptec();
    server.p1.send({ netPowerW: -100 });

    expect((await snapshot()).surplusW).toBe(4200);
  });
});

describe("Fuse headroom", () => {
  it("on 3 phases is the main fuse minus House consumption on the busiest phase", async () => {
    server = await startTestServer({
      charger: { phaseSetting: 3, phaseCurrentsA: { l1: 6, l2: 6, l3: 6 } },
    });
    server.p1.send({
      netPowerW: 6440,
      phases: { l1: importing(14), l2: importing(9), l3: importing(5) },
    });

    // House consumption: 8 A, 3 A and -1 A; the busiest phase is L1.
    expect((await snapshot()).fuseHeadroomA).toBeCloseTo(17);
  });

  it("on 1 phase looks only at L1, the phase the charger uses", async () => {
    server = await startTestServer({
      charger: { phaseSetting: 1, phaseCurrentsA: { l1: 10, l2: 0, l3: 0 } },
    });
    server.p1.send({
      netPowerW: 9200,
      phases: { l1: importing(18), l2: importing(20), l3: importing(2) },
    });

    expect((await snapshot()).fuseHeadroomA).toBeCloseTo(17);
  });

  it("counts a phase that exports as current flowing back", async () => {
    server = await startTestServer({
      charger: { phaseSetting: 1, phaseCurrentsA: { l1: 6, l2: 0, l3: 0 } },
    });
    server.p1.send({
      netPowerW: -1600,
      // The P1 meter reports current without a sign; the power has it.
      phases: { l1: { powerW: -1600, currentA: 6.9, voltageV: 231 } },
    });

    // House consumption on L1: -6.9 A - 6 A = -12.9 A.
    expect((await snapshot()).fuseHeadroomA).toBeCloseTo(37.9);
  });

  it("uses the main fuse rating it is given", async () => {
    server = await startTestServer({
      mainFuseA: 35,
      charger: { phaseSetting: 1, phaseCurrentsA: { l1: 0 } },
    });
    server.p1.send({ netPowerW: 2300, phases: { l1: importing(10) } });

    const live = await snapshot();
    expect(live.mainFuseA).toBe(35);
    expect(live.fuseHeadroomA).toBeCloseTo(25);
  });

  it("is missing when the P1 meter sends no per-phase currents", async () => {
    server = await startTestServer({
      charger: { phaseSetting: 3, phaseCurrentsA: { l1: 6, l2: 6, l3: 6 } },
    });
    server.p1.send({ netPowerW: 4000 });

    expect((await snapshot()).fuseHeadroomA).toBeNull();
  });
});
