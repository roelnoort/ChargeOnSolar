import {
  decisionEvent,
  type LiveSnapshot,
  liveSnapshot,
  liveStreamPath,
  shadowDecisionRecord,
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
  const response = await server?.requestSignedIn(liveStreamPath);
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
      charger: null,
      surplusW: null,
      mainFuseA: 25,
      fuseHeadroomA: null,
      override: { command: "pause", unavailableReason: "charger-offline" },
      switchBudget: null,
      shadowDecision: null,
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

describe("Shadow decisions on GET /api/live/stream", () => {
  const exporting = (watts: number) => ({
    netPowerW: -watts,
    phases: { l1: { powerW: -watts, currentA: watts / 230, voltageV: 230 } },
  });

  async function startWithCar() {
    server = await startTestServer({
      now: new Date("2026-06-01T12:00:00.000Z"),
      charger: {
        operationMode: 2,
        phaseSetting: 1,
        maxCurrentA: 16,
        phaseCurrentsA: { l1: 0 },
      },
    });
    return server;
  }

  async function nextOf(reader: SseReader, name: string) {
    for (let event = await reader.next(); event; event = await reader.next()) {
      if (event.event === name) return event;
    }
    return undefined;
  }

  it("sends each new Shadow decision as a decision event, with that minute's averages", async () => {
    const { p1, advance } = await startWithCar();
    p1.send(exporting(3300));
    const reader = await openStream();
    await nextSnapshot(reader);

    await advance(60_000);

    const event = await nextOf(reader, decisionEvent);
    const decision = shadowDecisionRecord.parse(JSON.parse(event?.data ?? ""));
    expect(decision.at).toBe("2026-06-01T12:01:00.000Z");
    expect(decision.decision).toEqual({
      kind: "start",
      currentAmps: 14,
      limitedBy: "surplus",
    });
    expect(decision.inputs).toMatchObject({
      surplusW: 3300,
      netPowerW: -3300,
      startWindowSurplusW: 3300,
    });
  });

  it("includes the current Shadow decision in the snapshot", async () => {
    const { p1, advance } = await startWithCar();
    p1.send(exporting(3300));
    await advance(60_000);

    const snapshot = await nextSnapshot(await openStream());

    expect(snapshot.shadowDecision?.decision.kind).toBe("start");
    expect(snapshot.shadowDecision?.chargingCurrentA).toBe(14);
  });
});
