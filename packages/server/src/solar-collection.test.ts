import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  apiError,
  callBudget,
  csrfHeader,
  livePath,
  liveSnapshot,
  liveStreamPath,
  solarBudgetPath,
  solarRefreshPath,
  solarRefreshResponse,
  solarUpdated,
  solarUpdatedEvent,
} from "@charge-on-solar/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createRefreshTokenStore } from "./enphase/refresh-token-store.ts";
import {
  startTestServer,
  type TestServer,
  type TestServerOptions,
} from "./testing/harness.ts";
import { readSse, type SseReader } from "./testing/sse.ts";

let server: TestServer | undefined;
let stream: SseReader | undefined;
afterEach(async () => {
  await stream?.close();
  await server?.close();
  stream = undefined;
  server = undefined;
});

const minute = 60_000;
const hour = 60 * minute;

// 2026-06-01 is a summer day: Europe/Amsterdam is UTC+2.
const june1 = {
  dayStart: new Date("2026-05-31T22:00:00.000Z"),
  noon: new Date("2026-06-01T10:00:00.000Z"),
};
const allJune1 = {
  from: new Date("2026-05-31T22:00:00.000Z"),
  to: new Date("2026-06-01T22:00:00.000Z"),
  limit: 500,
};

async function start(options: TestServerOptions = {}) {
  server = await startTestServer({
    now: new Date("2026-06-01T12:00:00.000Z"),
    ...options,
  });
  return server;
}

function refresh(testServer: TestServer) {
  return testServer.requestSignedIn(solarRefreshPath, {
    method: "POST",
    headers: { [csrfHeader.name]: csrfHeader.value },
  });
}

async function snapshot(testServer: TestServer) {
  return liveSnapshot.parse(
    await (await testServer.requestSignedIn(livePath)).json()
  );
}

async function budget(testServer: TestServer) {
  return callBudget.parse(
    await (await testServer.requestSignedIn(solarBudgetPath)).json()
  );
}

describe("the daily fetch from Enphase", () => {
  it("fetches the day's production intervals once a day, at 23:30 Europe/Amsterdam", async () => {
    const { enphase, clock } = await start();
    expect(enphase.fetches).toEqual([]);

    clock.advance(9 * hour + 29 * minute);
    await server?.settle();
    expect(enphase.fetches).toEqual([]);

    await server?.advanceUntilSolarFetch(minute);
    expect(enphase.fetches).toEqual([june1.dayStart]);

    await server?.advanceUntilSolarFetch(24 * hour);
    expect(enphase.fetches).toEqual([
      june1.dayStart,
      new Date("2026-06-01T22:00:00.000Z"),
    ]);
  });

  it("keeps to 23:30 local time across the end of summer time", async () => {
    const { enphase } = await start({
      now: new Date("2026-10-24T21:00:00.000Z"),
    });

    await server?.advanceUntilSolarFetch(30 * minute);
    expect(enphase.fetches).toEqual([new Date("2026-10-23T22:00:00.000Z")]);

    // Sunday 25 October has 25 hours; 23:30 CET is 22:30 UTC.
    server?.clock.advance(25 * hour - 1);
    await server?.settle();
    expect(enphase.fetches).toHaveLength(1);
    await server?.advanceUntilSolarFetch(1);
    expect(enphase.fetches).toEqual([
      new Date("2026-10-23T22:00:00.000Z"),
      new Date("2026-10-24T22:00:00.000Z"),
    ]);
  });

  it("stores each 5-minute production interval of the day", async () => {
    await start({
      solar: [
        { endAt: "2026-06-01T09:55:00.000Z", solarProductionW: 3900 },
        { endAt: "2026-06-01T10:00:00.000Z", solarProductionW: 4200 },
      ],
    });

    await server?.advanceUntilSolarFetch(9 * hour + 30 * minute);

    const stored = await server?.storage.listSolarIntervals(allJune1);
    expect(stored?.map((interval) => interval.solarProductionW)).toEqual([
      3900, 4200,
    ]);
    expect(stored?.[1]?.endAt).toEqual(june1.noon);
  });

  it("updates an interval in place when a later fetch revises it", async () => {
    const testServer = await start({
      solar: [
        {
          endAt: "2026-06-01T10:00:00.000Z",
          solarProductionW: 1800,
          devicesReporting: 6,
        },
      ],
    });
    await refresh(testServer);

    testServer.enphase.set([
      {
        endAt: "2026-06-01T10:00:00.000Z",
        solarProductionW: 4200,
        devicesReporting: 14,
      },
    ]);
    await testServer.advanceUntilSolarFetch(9 * hour + 30 * minute);

    expect(await testServer.storage.listSolarIntervals(allJune1)).toEqual([
      {
        endAt: june1.noon,
        solarProductionW: 4200,
        energyWh: 350,
        devicesReporting: 14,
      },
    ]);
  });

  it("retries a failing fetch with growing back-off, then recovers", async () => {
    const { enphase } = await start({
      enphaseUnreachable: true,
      solar: [{ endAt: "2026-06-01T10:00:00.000Z", solarProductionW: 4200 }],
    });
    await server?.advanceUntilSolarFetch(9 * hour + 30 * minute);
    expect(enphase.fetches).toHaveLength(1);

    await server?.advanceUntilSolarFetch(5 * minute);
    expect(enphase.fetches).toHaveLength(2);
    server?.clock.advance(10 * minute - 1);
    await server?.settle();
    expect(enphase.fetches).toHaveLength(2);

    enphase.unreachable = false;
    await server?.advanceUntilSolarFetch(1);

    expect(enphase.fetches).toEqual([
      june1.dayStart,
      june1.dayStart,
      june1.dayStart,
    ]);
    expect(await server?.storage.listSolarIntervals(allJune1)).toHaveLength(1);
    expect(server?.logs).toContainEqual(
      expect.stringContaining("Enphase unreachable")
    );
  });

  it("skips the daily fetch, without retrying, once the month's calls are spent", async () => {
    const testServer = await start();
    await testServer.useEnphaseCalls(999);

    testServer.clock.advance(9 * hour + 30 * minute);
    await testServer.settle();
    testServer.clock.advance(hour);
    await testServer.settle();

    expect(testServer.enphase.fetches).toEqual([]);
    expect(testServer.logs).toContainEqual(
      expect.stringMatching(/Enphase call budget/)
    );
  });
});

describe("POST /api/solar/refresh", () => {
  it("fetches today's latest data and answers it with the remaining budget", async () => {
    const testServer = await start({
      solar: [
        { endAt: "2026-06-01T09:55:00.000Z", solarProductionW: 3900 },
        { endAt: "2026-06-01T10:00:00.000Z", solarProductionW: 4200 },
      ],
    });

    const response = await refresh(testServer);

    expect(response.status).toBe(200);
    expect(solarRefreshResponse.parse(await response.json())).toEqual({
      solar: { asOf: "2026-06-01T10:00:00.000Z", solarProductionW: 4200 },
      budget: { month: "2026-06", limit: 1000, used: 2, remaining: 998 },
    });
    expect(testServer.enphase.fetches).toEqual([june1.dayStart]);
    expect(await testServer.storage.listSolarIntervals(allJune1)).toHaveLength(
      2
    );
  });

  it("gives the live snapshot Solar production and House consumption", async () => {
    const testServer = await start({
      charger: { chargerPowerW: 2000 },
      solar: [{ endAt: "2026-06-01T10:00:00.000Z", solarProductionW: 4200 }],
    });
    testServer.p1.send({ netPowerW: -1500 });
    await refresh(testServer);

    const live = await snapshot(testServer);

    expect(live.solar).toEqual({
      asOf: "2026-06-01T10:00:00.000Z",
      solarProductionW: 4200,
    });
    expect(live.houseConsumptionW).toBe(700);
    // Enphase is display-only: Surplus is Charger power minus Net power.
    expect(live.surplusW).toBe(3500);
  });

  it("leaves House consumption unknown without Solar production", async () => {
    const testServer = await start({ charger: { chargerPowerW: 2000 } });
    testServer.p1.send({ netPowerW: -1500 });

    const live = await snapshot(testServer);

    expect(live.solar).toBeNull();
    expect(live.houseConsumptionW).toBeNull();
  });

  it("refuses with a readable reason when the refresh would eat into the daily fetches' calls", async () => {
    const testServer = await start({
      solar: [{ endAt: "2026-06-01T10:00:00.000Z", solarProductionW: 4200 }],
    });
    // 30 daily fetches left in June, two calls each: 60 calls kept back.
    await testServer.useEnphaseCalls(939);

    const response = await refresh(testServer);

    expect(response.status).toBe(429);
    const { error } = apiError.parse(await response.json());
    expect(error.message).toMatch(/61 of this month's 1,000 Enphase calls/);
    expect(testServer.enphase.fetches).toEqual([]);
  });

  it("refreshes when exactly enough calls are left over for the daily fetches", async () => {
    const testServer = await start();
    await testServer.useEnphaseCalls(938);

    expect((await refresh(testServer)).status).toBe(200);
  });

  it("answers 502 with the reason when Enphase cannot be read", async () => {
    const testServer = await start({ enphaseUnreachable: true });

    const response = await refresh(testServer);

    expect(response.status).toBe(502);
    const { error } = apiError.parse(await response.json());
    expect(error.message).toMatch(/Enphase.*fetch failed/);
  });

  it("answers 503 while Enphase is not set up", async () => {
    const testServer = await start({ withoutEnphase: true });

    const response = await refresh(testServer);

    expect(response.status).toBe(503);
  });

  it("needs the CSRF header", async () => {
    const testServer = await start();

    const response = await testServer.requestSignedIn(solarRefreshPath, {
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(testServer.enphase.fetches).toEqual([]);
  });
});

describe("the Enphase call budget", () => {
  it("shows the month's remaining calls through the API", async () => {
    const testServer = await start();
    expect(await budget(testServer)).toEqual({
      month: "2026-06",
      limit: 1000,
      used: 0,
      remaining: 1000,
    });

    await refresh(testServer);
    await refresh(testServer);

    // The second refresh reuses the day's access token.
    expect((await budget(testServer)).used).toBe(3);
  });

  it("starts afresh each calendar month", async () => {
    const testServer = await start({
      now: new Date("2026-06-30T21:45:00.000Z"),
    });
    await testServer.useEnphaseCalls(500);

    testServer.clock.advance(15 * minute);

    expect(await budget(testServer)).toMatchObject({
      month: "2026-07",
      used: 0,
    });
  });
});

describe("solar-updated on the live stream", () => {
  it("is sent after each fetch, with the latest Solar production", async () => {
    const testServer = await start({
      solar: [{ endAt: "2026-06-01T10:00:00.000Z", solarProductionW: 4200 }],
    });
    const response = await testServer.requestSignedIn(liveStreamPath);
    stream = readSse(response);
    await stream.next();

    await refresh(testServer);

    const events = [await stream.next(), await stream.next()];
    const updated = events.find((event) => event?.event === solarUpdatedEvent);
    expect(solarUpdated.parse(JSON.parse(updated?.data ?? ""))).toEqual({
      fetchedAt: "2026-06-01T12:00:00.000Z",
      solar: { asOf: "2026-06-01T10:00:00.000Z", solarProductionW: 4200 },
    });
  });
});

describe("the stored Enphase refresh token", () => {
  it("is encrypted, never kept in plain text", async () => {
    const testServer = await start();
    await refresh(testServer);

    expect(await testServer.enphaseRefreshTokens.load()).toBe(
      "fake-refresh-token-2"
    );
    const onDisk = Buffer.concat(
      await Promise.all(
        [testServer.databaseFile, `${testServer.databaseFile}-wal`].map(
          (file) => readFile(file).catch(() => Buffer.alloc(0))
        )
      )
    );
    expect(onDisk.includes("fake-refresh-token-2")).toBe(false);
  });

  it("cannot be read back with another key", async () => {
    const testServer = await start();
    await refresh(testServer);

    const otherKey = createRefreshTokenStore({
      storage: testServer.storage,
      key: Buffer.alloc(32, 7),
    });

    await expect(otherKey.load()).rejects.toThrow();
  });
});

describe("Solar production after a restart", () => {
  it("comes back from the stored intervals", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "chargeonsolar-"));
    try {
      const first = await start({
        dataDir,
        solar: [{ endAt: "2026-06-01T10:00:00.000Z", solarProductionW: 4200 }],
      });
      await refresh(first);
      await first.close();

      const second = await start({
        dataDir,
        now: new Date("2026-06-01T12:05:00.000Z"),
      });

      const { authorization } = await second.signIn("test-user@example.com");
      const response = await second.request(livePath, {
        headers: { authorization },
      });
      expect(liveSnapshot.parse(await response.json()).solar).toEqual({
        asOf: "2026-06-01T10:00:00.000Z",
        solarProductionW: 4200,
      });
      await second.close();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
