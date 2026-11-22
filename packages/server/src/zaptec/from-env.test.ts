import { describe, expect, it } from "vitest";
import { createFakeClock } from "../testing/fake-clock.ts";
import { mainFuseFromEnv, zaptecClientFromEnv } from "./from-env.ts";

const clock = createFakeClock(new Date("2026-06-01T12:00:00.000Z"));

describe("the Zaptec client from .env", () => {
  it("is a cloud client once the Zaptec username and password are set", () => {
    const env = { ZAPTEC_USERNAME: "owner@example.com", ZAPTEC_PASSWORD: "pw" };

    expect(zaptecClientFromEnv(env, clock)).toBeDefined();
  });

  it("is absent while Zaptec is not set up", () => {
    expect(zaptecClientFromEnv({}, clock)).toBeUndefined();
    expect(
      zaptecClientFromEnv({ ZAPTEC_USERNAME: "owner@example.com" }, clock)
    ).toBeUndefined();
  });
});

describe("the main fuse rating from .env", () => {
  it("is MAIN_FUSE_A when set", () => {
    expect(mainFuseFromEnv({ MAIN_FUSE_A: "35" })).toBe(35);
  });

  it("is left to the default when unset", () => {
    expect(mainFuseFromEnv({})).toBeUndefined();
  });

  it("refuses a rating that is not a positive number", () => {
    expect(() => mainFuseFromEnv({ MAIN_FUSE_A: "lots" })).toThrow();
    expect(() => mainFuseFromEnv({ MAIN_FUSE_A: "0" })).toThrow();
  });
});
