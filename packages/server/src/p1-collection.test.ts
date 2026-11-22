import { healthPath, livePath, liveSnapshot } from "@charge-on-solar/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startTestServer, type TestServer } from "./testing/harness.ts";

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

describe("collecting from the P1 meter", () => {
  it("records every Reading with when the server received it", async () => {
    server = await startTestServer({
      now: new Date("2026-06-01T12:00:00.000Z"),
    });
    server.p1.send({
      netPowerW: 1500,
      phases: { l1: { powerW: 1500, currentA: 6.5, voltageV: 230.1 } },
      deviceTimestamp: "2026-06-01T14:00:00",
    });
    server.clock.advance(1000);
    server.p1.send({ netPowerW: -300 });

    await vi.waitFor(async () =>
      expect(await server?.storage.listP1Readings(allDay)).toHaveLength(2)
    );
    expect(await server.storage.listP1Readings(allDay)).toEqual([
      {
        receivedAt: new Date("2026-06-01T12:00:00.000Z"),
        deviceTimestamp: "2026-06-01T14:00:00",
        netPowerW: 1500,
        phases: {
          l1: { powerW: 1500, currentA: 6.5, voltageV: 230.1 },
          l2: { powerW: null, currentA: null, voltageV: null },
          l3: { powerW: null, currentA: null, voltageV: null },
        },
      },
      {
        receivedAt: new Date("2026-06-01T12:00:01.000Z"),
        deviceTimestamp: null,
        netPowerW: -300,
        phases: {
          l1: { powerW: null, currentA: null, voltageV: null },
          l2: { powerW: null, currentA: null, voltageV: null },
          l3: { powerW: null, currentA: null, voltageV: null },
        },
      },
    ]);
  });

  it("lists recorded Readings a window and a page at a time", async () => {
    server = await startTestServer({
      now: new Date("2026-06-01T12:00:00.000Z"),
    });
    for (const netPowerW of [100, 200, 300, 400]) {
      server.p1.send({ netPowerW });
      server.clock.advance(1000);
    }

    const page = await server.storage.listP1Readings({
      from: new Date("2026-06-01T12:00:01.000Z"),
      to: new Date("2026-06-01T12:00:04.000Z"),
      limit: 2,
    });

    expect(page.map((reading) => reading.netPowerW)).toEqual([200, 300]);
  });

  it("keeps answering the API while the P1 meter is unreachable", async () => {
    server = await startTestServer({ p1Unreachable: true });

    expect((await server.request(healthPath)).status).toBe(200);
    expect((await server.request(livePath)).status).toBe(200);
  });

  it("retries an unreachable P1 meter with growing back-off", async () => {
    server = await startTestServer({ p1Unreachable: true });
    const { p1, clock } = server;
    expect(p1.connectAttempts).toBe(1);

    clock.advance(1000);
    await vi.waitFor(() => expect(p1.connectAttempts).toBe(2));
    clock.advance(1999);
    await Promise.resolve();
    expect(p1.connectAttempts).toBe(2);
    clock.advance(1);
    await vi.waitFor(() => expect(p1.connectAttempts).toBe(3));
  });

  it("reconnects after the stream drops, and collects again", async () => {
    server = await startTestServer();
    server.p1.send({ netPowerW: 100 });

    server.p1.drop();
    await vi.waitFor(() => expect(server?.p1.connected).toBe(false));
    server.clock.advance(1000);
    await server.p1.whenConnected();
    server.p1.send({ netPowerW: 250 });

    const { p1 } = liveSnapshot.parse(
      await (await server.request(livePath)).json()
    );
    expect(p1?.reading.netPowerW).toBe(250);
    expect(server.logs).toContainEqual(
      expect.stringContaining("P1 meter disconnected")
    );
  });
});
