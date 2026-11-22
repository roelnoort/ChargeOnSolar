import { describe, expect, it } from "vitest";
import { createFakeClock } from "../testing/fake-clock.ts";
import { p1ClientFromEnv } from "./from-env.ts";

const clock = createFakeClock(new Date("2026-06-01T12:00:00.000Z"));

describe("the P1 client from .env", () => {
  it("is a HomeWizard client once the meter's address and token are set", () => {
    const env = { HOMEWIZARD_HOST: "192.168.1.20", HOMEWIZARD_TOKEN: "abc" };

    expect(p1ClientFromEnv(env, clock)).toBeDefined();
  });

  it("is absent while the meter is not set up", () => {
    expect(p1ClientFromEnv({}, clock)).toBeUndefined();
    expect(
      p1ClientFromEnv({ HOMEWIZARD_HOST: "192.168.1.20" }, clock)
    ).toBeUndefined();
  });
});
