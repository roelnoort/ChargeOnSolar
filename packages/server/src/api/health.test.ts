import { describe, expect, it } from "vitest";
import { toHealth } from "./health.ts";

describe("toHealth", () => {
  it("maps a Startup onto the shared health contract", () => {
    expect(
      toHealth({ at: new Date("2026-06-01T08:30:00.000Z"), version: "0.1.0" })
    ).toEqual({
      status: "ok",
      version: "0.1.0",
      startedAt: "2026-06-01T08:30:00.000Z",
    });
  });

  it("refuses a Startup that breaks the shared contract", () => {
    expect(() =>
      toHealth({ at: new Date("2026-06-01T08:30:00.000Z"), version: "" })
    ).toThrow();
  });
});
