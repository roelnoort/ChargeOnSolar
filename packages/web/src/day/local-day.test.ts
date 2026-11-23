import { describe, expect, it } from "vitest";
import {
  amsterdamToday,
  describeDay,
  nextAmsterdamDayAt,
  shiftDay,
} from "./local-day.ts";

describe("the Europe/Amsterdam day", () => {
  it("starts at local midnight, not UTC midnight", () => {
    // 23:30 UTC on 31 May is 01:30 on 1 June in Amsterdam (UTC+2).
    expect(amsterdamToday(Date.parse("2026-05-31T23:30:00.000Z"))).toBe(
      "2026-06-01"
    );
    expect(amsterdamToday(Date.parse("2026-05-31T21:30:00.000Z"))).toBe(
      "2026-05-31"
    );
  });

  it("moves a day back and forward, across months, years and clock changes", () => {
    expect(shiftDay("2026-06-01", -1)).toBe("2026-05-31");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2026-03-29", 1)).toBe("2026-03-30");
    expect(shiftDay("2026-10-26", -1)).toBe("2026-10-25");
  });

  it("names today and yesterday, and dates the days before", () => {
    expect(describeDay("2026-06-01", "2026-06-01")).toBe("Today");
    expect(describeDay("2026-05-31", "2026-06-01")).toBe("Yesterday");
    expect(describeDay("2026-05-28", "2026-06-01")).toBe("Thu 28 May");
  });
});

describe("when the next Europe/Amsterdam day begins", () => {
  const nextDay = (now: string) =>
    new Date(nextAmsterdamDayAt(Date.parse(now))).toISOString();

  it("is the coming local midnight", () => {
    expect(nextDay("2026-11-23T13:30:00.000Z")).toBe(
      "2026-11-23T23:00:00.000Z"
    );
    expect(nextDay("2026-06-01T21:59:59.999Z")).toBe(
      "2026-06-01T22:00:00.000Z"
    );
  });

  it("follows the clocks going forward and back", () => {
    expect(nextDay("2026-03-29T12:00:00.000Z")).toBe(
      "2026-03-29T22:00:00.000Z"
    );
    expect(nextDay("2026-10-25T12:00:00.000Z")).toBe(
      "2026-10-25T23:00:00.000Z"
    );
  });
});
