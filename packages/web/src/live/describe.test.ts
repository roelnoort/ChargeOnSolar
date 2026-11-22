import { describe, expect, it } from "vitest";
import { describeDataAge, describeNetPower, p1DataAgeMs } from "./describe.ts";

describe("describing Net power", () => {
  it("says the house imports when Net power is positive", () => {
    expect(describeNetPower(1543)).toEqual({
      direction: "importing",
      label: "Importing",
      power: "1.54 kW",
    });
  });

  it("says the house exports when Net power is negative", () => {
    expect(describeNetPower(-850)).toEqual({
      direction: "exporting",
      label: "Exporting",
      power: "850 W",
    });
  });

  it("says neither at zero", () => {
    expect(describeNetPower(0)).toEqual({
      direction: "balanced",
      label: "Balanced",
      power: "0 W",
    });
  });
});

describe("the P1 data age", () => {
  const snapshot = {
    at: "2026-06-01T12:00:10.000Z",
    lastSeenAt: "2026-06-01T12:00:08.000Z",
  };

  it("is the age when the server sent it, plus the time since", () => {
    expect(
      p1DataAgeMs({
        serverAt: snapshot.at,
        lastSeenAt: snapshot.lastSeenAt,
        receivedAt: 50_000,
        now: 53_500,
      })
    ).toBe(5_500);
  });

  it("reads as seconds, then minutes, then hours", () => {
    expect(describeDataAge(400)).toEqual({ text: "just now", stale: false });
    expect(describeDataAge(5_500)).toEqual({ text: "5 s old", stale: false });
    expect(describeDataAge(42_000)).toEqual({ text: "42 s old", stale: true });
    expect(describeDataAge(185_000)).toEqual({
      text: "3 min old",
      stale: true,
    });
    expect(describeDataAge(2 * 3_600_000 + 60_000)).toEqual({
      text: "2 h old",
      stale: true,
    });
  });
});
