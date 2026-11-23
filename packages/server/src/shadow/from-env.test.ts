import { describe, expect, it } from "vitest";
import { shadowTickFromEnv } from "./from-env.ts";

describe("the Shadow runner's tick from .env", () => {
  it("is SHADOW_TICK_SECONDS when set", () => {
    expect(shadowTickFromEnv({ SHADOW_TICK_SECONDS: "30" })).toBe(30);
  });

  it("is left to the default when unset", () => {
    expect(shadowTickFromEnv({})).toBeUndefined();
  });

  it("refuses a tick that is not a positive whole number of seconds", () => {
    expect(() => shadowTickFromEnv({ SHADOW_TICK_SECONDS: "often" })).toThrow();
    expect(() => shadowTickFromEnv({ SHADOW_TICK_SECONDS: "0" })).toThrow();
    expect(() => shadowTickFromEnv({ SHADOW_TICK_SECONDS: "1.5" })).toThrow();
  });
});
