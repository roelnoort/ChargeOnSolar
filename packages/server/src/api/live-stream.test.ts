import {
  type LiveSnapshot,
  liveSnapshot,
  liveStreamPath,
  snapshotEvent,
} from "@charge-on-solar/shared";
import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../testing/harness.ts";
import { readSse, type SseReader } from "../testing/sse.ts";

let server: TestServer | undefined;
let stream: SseReader | undefined;
afterEach(async () => {
  await stream?.close();
  await server?.close();
  stream = undefined;
  server = undefined;
});

async function openStream(): Promise<SseReader> {
  const response = await server?.request(liveStreamPath);
  expect(response?.status).toBe(200);
  expect(response?.headers.get("content-type")).toContain("text/event-stream");
  stream = readSse(response as Response);
  return stream;
}

async function nextSnapshot(reader: SseReader): Promise<LiveSnapshot> {
  const event = await reader.next();
  expect(event?.event).toBe(snapshotEvent);
  return liveSnapshot.parse(JSON.parse(event?.data ?? ""));
}

async function start() {
  server = await startTestServer({
    now: new Date("2026-06-01T12:00:00.000Z"),
  });
  return server;
}

describe("GET /api/live/stream", () => {
  it("sends the full snapshot as soon as it opens", async () => {
    const { p1 } = await start();
    p1.send({ netPowerW: 700 });

    const snapshot = await nextSnapshot(await openStream());

    expect(snapshot).toEqual({
      at: "2026-06-01T12:00:00.000Z",
      p1: {
        lastSeenAt: "2026-06-01T12:00:00.000Z",
        reading: {
          netPowerW: 700,
          phases: {
            l1: { powerW: null, currentA: null, voltageV: null },
            l2: { powerW: null, currentA: null, voltageV: null },
            l3: { powerW: null, currentA: null, voltageV: null },
          },
          deviceTimestamp: null,
        },
      },
    });
  });

  it("sends a new Reading straight away when the last event is a second old", async () => {
    const { p1, clock } = await start();
    const reader = await openStream();
    await nextSnapshot(reader);

    clock.advance(1000);
    p1.send({ netPowerW: -1200 });

    const snapshot = await nextSnapshot(reader);
    expect(snapshot.p1?.reading.netPowerW).toBe(-1200);
    expect(snapshot.at).toBe("2026-06-01T12:00:01.000Z");
  });

  it("sends at most one event a second, carrying the latest Reading", async () => {
    const { p1, clock } = await start();
    const reader = await openStream();
    await nextSnapshot(reader);

    p1.send({ netPowerW: 100 });
    clock.advance(400);
    p1.send({ netPowerW: 200 });
    expect(await reader.next(50)).toBeUndefined();

    clock.advance(600);
    const snapshot = await nextSnapshot(reader);
    expect(snapshot.p1?.reading.netPowerW).toBe(200);
    expect(snapshot.at).toBe("2026-06-01T12:00:01.000Z");
    expect(await reader.next(50)).toBeUndefined();
  });

  it("sends nothing while nothing changes", async () => {
    const { p1, clock } = await start();
    p1.send({ netPowerW: 300 });
    const reader = await openStream();
    await nextSnapshot(reader);

    clock.advance(10_000);

    expect(await reader.next(50)).toBeUndefined();
  });
});
