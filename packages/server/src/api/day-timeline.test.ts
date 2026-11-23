import {
  csrfHeader,
  type DayTimeline,
  dayTimeline,
  dayTimelinePath,
  solarRefreshPath,
} from "@charge-on-solar/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  startTestServer,
  type TestServer,
  type TestServerOptions,
} from "../testing/harness.ts";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const minute = 60_000;

async function start(options: TestServerOptions) {
  server = await startTestServer(options);
  return server;
}

async function timeline(testServer: TestServer, day: string) {
  const response = await testServer.requestSignedIn(
    `${dayTimelinePath}?day=${day}`
  );
  expect(response.status).toBe(200);
  return dayTimeline.parse(await response.json());
}

function bucketAt(day: DayTimeline, start: string) {
  return day.buckets.find((bucket) => bucket.start === start);
}

async function refreshSolar(testServer: TestServer) {
  const response = await testServer.requestSignedIn(solarRefreshPath, {
    method: "POST",
    headers: { [csrfHeader.name]: csrfHeader.value },
  });
  expect(response.status).toBe(200);
}

describe("GET /api/day-timeline", () => {
  it("averages the day's recorded Readings and Solar production into 5-minute buckets", async () => {
    // 2026-06-01 is a summer day: Europe/Amsterdam is UTC+2.
    const testServer = await start({
      now: new Date("2026-06-01T08:00:00.000Z"),
      charger: { chargerPowerW: 3000 },
      solar: [
        { endAt: "2026-06-01T08:05:00.000Z", solarProductionW: 1200 },
        { endAt: "2026-06-01T08:10:00.000Z", solarProductionW: 1500 },
      ],
    });
    const { p1, clock } = testServer;
    p1.send({ netPowerW: 1000 });
    clock.advance(2 * minute);
    p1.send({ netPowerW: -500 });
    clock.advance(4 * minute);
    p1.send({ netPowerW: 2000 });
    await testServer.pollZaptec(minute);
    clock.advance(5 * minute);
    await refreshSolar(testServer);
    await testServer.settle();

    const day = await timeline(testServer, "2026-06-01");

    expect(day.day).toBe("2026-06-01");
    expect(day.start).toBe("2026-05-31T22:00:00.000Z");
    expect(day.end).toBe("2026-06-01T22:00:00.000Z");
    expect(day.solarFetchedAt).toBe("2026-06-01T08:12:00.000Z");
    expect(day.buckets).toHaveLength(288);
    expect(day.buckets[0]?.start).toBe("2026-05-31T22:00:00.000Z");
    expect(bucketAt(day, "2026-06-01T07:55:00.000Z")).toEqual({
      start: "2026-06-01T07:55:00.000Z",
      solarProductionW: 0,
      netPowerW: null,
      chargerPowerW: null,
    });
    expect(bucketAt(day, "2026-06-01T08:00:00.000Z")).toEqual({
      start: "2026-06-01T08:00:00.000Z",
      solarProductionW: 1200,
      netPowerW: 250,
      chargerPowerW: 3000,
    });
    expect(bucketAt(day, "2026-06-01T08:05:00.000Z")).toEqual({
      start: "2026-06-01T08:05:00.000Z",
      solarProductionW: 1500,
      netPowerW: 2000,
      chargerPowerW: 3000,
    });
    expect(bucketAt(day, "2026-06-01T08:10:00.000Z")).toMatchObject({
      solarProductionW: null,
      netPowerW: null,
    });
  });

  it("leaves Solar production out of a day Enphase has not been asked for yet", async () => {
    const testServer = await start({
      now: new Date("2026-06-01T08:00:00.000Z"),
      charger: { chargerPowerW: 2000 },
      solar: [{ endAt: "2026-06-01T08:00:00.000Z", solarProductionW: 900 }],
    });
    testServer.p1.send({ netPowerW: 400 });

    const day = await timeline(testServer, "2026-06-01");

    expect(day.solarFetchedAt).toBeNull();
    expect(day.buckets.every((b) => b.solarProductionW === null)).toBe(true);
    expect(bucketAt(day, "2026-06-01T08:00:00.000Z")).toEqual({
      start: "2026-06-01T08:00:00.000Z",
      solarProductionW: null,
      netPowerW: 400,
      chargerPowerW: 2000,
    });
  });

  it("does not count a fetch of one day towards another", async () => {
    const testServer = await start({
      now: new Date("2026-06-01T08:00:00.000Z"),
      solar: [
        { endAt: "2026-05-31T10:00:00.000Z", solarProductionW: 800 },
        { endAt: "2026-06-01T08:00:00.000Z", solarProductionW: 900 },
      ],
    });
    await refreshSolar(testServer);

    const yesterday = await timeline(testServer, "2026-05-31");

    expect(yesterday.solarFetchedAt).toBeNull();
    expect(yesterday.buckets.every((b) => b.solarProductionW === null)).toBe(
      true
    );
  });

  it("covers the whole of a day once the daily fetch has run", async () => {
    const testServer = await start({
      now: new Date("2026-06-01T08:00:00.000Z"),
      solar: [{ endAt: "2026-06-01T12:00:00.000Z", solarProductionW: 2500 }],
    });
    // The daily fetch runs at 23:30 Amsterdam time: 21:30 UTC.
    await testServer.advanceUntilSolarFetch(13.5 * 60 * minute);
    testServer.clock.advance(3 * 60 * minute);

    const day = await timeline(testServer, "2026-06-01");

    expect(day.solarFetchedAt).toBe("2026-06-01T21:30:00.000Z");
    expect(bucketAt(day, "2026-06-01T11:55:00.000Z")?.solarProductionW).toBe(
      2500
    );
    expect(bucketAt(day, "2026-06-01T21:25:00.000Z")?.solarProductionW).toBe(0);
    // The sun has set by 23:30 (ADR 0002): the rest of the day had none.
    expect(bucketAt(day, "2026-06-01T21:30:00.000Z")?.solarProductionW).toBe(0);
    expect(day.buckets.at(-1)?.solarProductionW).toBe(0);
  });

  it("leaves the rest of today unknown after a refresh", async () => {
    const testServer = await start({
      now: new Date("2026-06-01T08:02:00.000Z"),
    });
    await refreshSolar(testServer);

    const day = await timeline(testServer, "2026-06-01");

    expect(bucketAt(day, "2026-06-01T07:55:00.000Z")?.solarProductionW).toBe(0);
    expect(bucketAt(day, "2026-06-01T08:00:00.000Z")?.solarProductionW).toBe(
      null
    );
    expect(day.buckets.at(-1)?.solarProductionW).toBeNull();
  });

  describe("on the days summer time starts and ends", () => {
    it("has 23 hours on the day the clocks go forward", async () => {
      const testServer = await start({
        now: new Date("2026-03-29T12:00:00.000Z"),
      });

      const day = await timeline(testServer, "2026-03-29");

      expect(day.start).toBe("2026-03-28T23:00:00.000Z");
      expect(day.end).toBe("2026-03-29T22:00:00.000Z");
      expect(day.buckets).toHaveLength(276);
      expect(day.buckets.at(-1)?.start).toBe("2026-03-29T21:55:00.000Z");
    });

    it("has 25 hours on the day the clocks go back, up to its own midnight", async () => {
      // 23:58 in Amsterdam, on winter time: UTC+1.
      const testServer = await start({
        now: new Date("2026-10-25T22:58:00.000Z"),
      });
      testServer.p1.send({ netPowerW: 700 });
      testServer.clock.advance(3 * minute);
      testServer.p1.send({ netPowerW: -300 });

      const day = await timeline(testServer, "2026-10-25");
      const nextDay = await timeline(testServer, "2026-10-26");

      expect(day.start).toBe("2026-10-24T22:00:00.000Z");
      expect(day.end).toBe("2026-10-25T23:00:00.000Z");
      expect(day.buckets).toHaveLength(300);
      expect(day.buckets.at(-1)).toMatchObject({
        start: "2026-10-25T22:55:00.000Z",
        netPowerW: 700,
      });
      expect(nextDay.start).toBe("2026-10-25T23:00:00.000Z");
      expect(nextDay.buckets).toHaveLength(288);
      expect(nextDay.buckets[0]).toMatchObject({
        start: "2026-10-25T23:00:00.000Z",
        netPowerW: -300,
      });
    });
  });

  it("refuses a day that is not a calendar date", async () => {
    const testServer = await start({
      now: new Date("2026-06-01T08:00:00.000Z"),
    });

    const response = await testServer.requestSignedIn(
      `${dayTimelinePath}?day=2026-02-30`
    );

    expect(response.status).toBe(400);
  });
});
