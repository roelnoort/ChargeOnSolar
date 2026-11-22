import { healthPath, livePath, liveSnapshot } from "@charge-on-solar/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startTestServer, type TestServer } from "./testing/harness.ts";
import { zaptecPollIntervalMs } from "./zaptec/collector.ts";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const allDay = {
  from: new Date("2026-06-01T00:00:00.000Z"),
  to: new Date("2026-06-02T00:00:00.000Z"),
  limit: 100,
};

async function snapshot() {
  return liveSnapshot.parse(await (await server?.request(livePath))?.json());
}

describe("collecting from Zaptec", () => {
  it("records each Reading, typed, with the full raw state", async () => {
    server = await startTestServer({
      now: new Date("2026-06-01T12:00:00.000Z"),
      charger: {
        chargerPowerW: 4140,
        chargingCurrentSetA: 6,
        operationMode: 3,
        phaseSetting: 3,
        maxCurrentA: 32,
        phaseCurrentsA: { l1: 6, l2: 6, l3: 6 },
        availableCurrentMode: 2,
        enabledFeatures: 3,
        surplusModeActive: false,
      },
    });

    await vi.waitFor(async () =>
      expect(await server?.storage.listChargerReadings(allDay)).toHaveLength(1)
    );
    const [reading] = await server.storage.listChargerReadings(allDay);
    expect(reading).toEqual({
      receivedAt: new Date("2026-06-01T12:00:00.000Z"),
      chargerPowerW: 4140,
      chargingCurrentSetA: 6,
      operationMode: 3,
      finalStopActive: false,
      nextScheduleEvent: null,
      phaseSetting: 3,
      maxCurrentA: 32,
      phaseCurrentsA: { l1: 6, l2: 6, l3: 6 },
      availableCurrentMode: 2,
      enabledFeatures: 3,
      surplusModeActive: false,
      rawState: expect.any(String),
    });
    expect(JSON.parse(reading?.rawState ?? "")).toEqual({
      fake: expect.objectContaining({ chargerPowerW: 4140 }),
    });
  });

  it(`reads Zaptec once every ${zaptecPollIntervalMs / 1000} s, no more`, async () => {
    server = await startTestServer({ charger: { chargerPowerW: 0 } });
    expect(server.zaptec.readAttempts).toBe(1);

    server.clock.advance(zaptecPollIntervalMs - 1);
    await Promise.resolve();
    expect(server.zaptec.readAttempts).toBe(1);

    await server.pollZaptec(1);
    expect(server.zaptec.readAttempts).toBe(2);
    expect(await server.storage.listChargerReadings(allDay)).toHaveLength(2);
  });

  it("lists recorded Readings a window and a page at a time", async () => {
    server = await startTestServer({
      now: new Date("2026-06-01T12:00:00.000Z"),
      charger: { chargerPowerW: 100 },
    });
    for (const chargerPowerW of [200, 300, 400]) {
      server.zaptec.set({ chargerPowerW });
      await server.pollZaptec();
    }

    const page = await server.storage.listChargerReadings({
      from: new Date("2026-06-01T12:00:30.000Z"),
      to: new Date("2026-06-01T12:01:30.000Z"),
      limit: 1,
    });

    expect(page.map((reading) => reading.chargerPowerW)).toEqual([200]);
  });

  it("retries an unreachable Zaptec with growing back-off, then recovers", async () => {
    server = await startTestServer({ zaptecUnreachable: true });
    const { zaptec, clock } = server;
    expect(zaptec.readAttempts).toBe(1);

    clock.advance(30_000);
    await vi.waitFor(() => expect(zaptec.readAttempts).toBe(2));
    clock.advance(59_999);
    await Promise.resolve();
    expect(zaptec.readAttempts).toBe(2);

    zaptec.unreachable = false;
    zaptec.set({ chargerPowerW: 1500 });
    await server.pollZaptec(1);

    expect((await snapshot()).charger?.reading.chargerPowerW).toBe(1500);
    expect(server.logs).toContainEqual(
      expect.stringContaining("Zaptec unreachable")
    );
  });

  it("leaves the P1 data and the API working while Zaptec fails", async () => {
    server = await startTestServer({ zaptecUnreachable: true });
    server.p1.send({ netPowerW: -900 });

    expect((await server.request(healthPath)).status).toBe(200);
    const live = await snapshot();
    expect(live.p1?.reading.netPowerW).toBe(-900);
    expect(live.charger).toBeNull();
  });

  it("keeps the last Zaptec Reading, getting older, while Zaptec fails", async () => {
    server = await startTestServer({ charger: { chargerPowerW: 2000 } });
    server.zaptec.unreachable = true;

    await server.pollZaptec();
    const live = await snapshot();

    expect(live.charger?.reading.chargerPowerW).toBe(2000);
    expect(
      Date.parse(live.at) - Date.parse(live.charger?.lastSeenAt ?? "")
    ).toBe(zaptecPollIntervalMs);
  });

  it("keeps the Zaptec data and the API working while the P1 meter fails", async () => {
    server = await startTestServer({
      p1Unreachable: true,
      charger: { chargerPowerW: 3000 },
    });

    const live = await snapshot();
    expect(live.p1).toBeNull();
    expect(live.charger?.reading.chargerPowerW).toBe(3000);
    expect(live.surplusW).toBeNull();
  });
});
