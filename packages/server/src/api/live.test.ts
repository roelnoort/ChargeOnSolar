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

describe("GET /api/live", () => {
  it("has no P1 Reading before the meter has sent one", async () => {
    server = await startTestServer({
      now: new Date("2026-06-01T12:00:00.000Z"),
    });

    expect(await snapshot()).toEqual({
      at: "2026-06-01T12:00:00.000Z",
      p1: null,
      charger: null,
      surplusW: null,
      mainFuseA: 25,
      fuseHeadroomA: null,
      solar: null,
      houseConsumptionW: null,
      override: { command: "pause", unavailableReason: "charger-offline" },
      switchBudget: null,
      shadowDecision: null,
    });
  });

  it("holds the latest P1 Reading and when it arrived", async () => {
    server = await startTestServer({
      now: new Date("2026-06-01T12:00:00.000Z"),
    });
    server.p1.send({ netPowerW: 1200 });
    server.clock.advance(1000);
    server.p1.send({
      netPowerW: -850,
      phases: {
        l1: { powerW: -900, currentA: 3.9, voltageV: 231.2 },
        l2: { powerW: 20, currentA: 0.2, voltageV: 229.8 },
        l3: { powerW: 30, currentA: 0.3, voltageV: 230.4 },
      },
      deviceTimestamp: "2026-06-01T14:00:01",
    });

    expect(await snapshot()).toEqual({
      at: "2026-06-01T12:00:01.000Z",
      p1: {
        lastSeenAt: "2026-06-01T12:00:01.000Z",
        reading: {
          netPowerW: -850,
          phases: {
            l1: { powerW: -900, currentA: 3.9, voltageV: 231.2 },
            l2: { powerW: 20, currentA: 0.2, voltageV: 229.8 },
            l3: { powerW: 30, currentA: 0.3, voltageV: 230.4 },
          },
          deviceTimestamp: "2026-06-01T14:00:01",
        },
      },
      charger: null,
      surplusW: null,
      mainFuseA: 25,
      fuseHeadroomA: null,
      solar: null,
      houseConsumptionW: null,
      override: { command: "pause", unavailableReason: "charger-offline" },
      switchBudget: null,
      shadowDecision: null,
    });
  });

  it("shows the P1 data getting older once the meter stops sending", async () => {
    server = await startTestServer({
      now: new Date("2026-06-01T12:00:00.000Z"),
    });
    server.p1.send({ netPowerW: 400 });

    server.clock.advance(45_000);
    const { at, p1 } = await snapshot();

    expect(Date.parse(at) - Date.parse(p1?.lastSeenAt ?? "")).toBe(45_000);
    expect(p1?.reading.netPowerW).toBe(400);
  });
});
