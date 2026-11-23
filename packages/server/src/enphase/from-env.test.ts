import { describe, expect, it } from "vitest";
import { enphaseLoginFromEnv, enphaseSetupFromEnv } from "./from-env.ts";

const key = "ab".repeat(32);
const complete = {
  ENPHASE_API_KEY: "api-key",
  ENPHASE_CLIENT_ID: "client-id",
  ENPHASE_CLIENT_SECRET: "client-secret",
  ENPHASE_SYSTEM_ID: "1234567",
  ENPHASE_TOKEN_KEY: key,
};

describe("the Enphase setup from .env", () => {
  it("is there once the app credentials, system ID and token key are set", () => {
    const setup = enphaseSetupFromEnv(complete);

    expect(setup?.refreshTokenKey).toEqual(Buffer.from(key, "hex"));
    expect(setup?.client).toBeTypeOf("function");
  });

  it("is absent while Enphase is not set up", () => {
    expect(enphaseSetupFromEnv({})).toBeUndefined();
    expect(
      enphaseSetupFromEnv({ ...complete, ENPHASE_SYSTEM_ID: undefined })
    ).toBeUndefined();
  });

  it("refuses to start without a usable token key once Enphase is set up", () => {
    expect(() =>
      enphaseSetupFromEnv({ ...complete, ENPHASE_TOKEN_KEY: undefined })
    ).toThrow(/ENPHASE_TOKEN_KEY.*openssl rand -hex 32/);
    expect(() =>
      enphaseSetupFromEnv({ ...complete, ENPHASE_TOKEN_KEY: "abc" })
    ).toThrow(/ENPHASE_TOKEN_KEY/);
  });
});

describe("the Enphase login settings from .env", () => {
  it("needs only the client credentials and the token key", () => {
    expect(
      enphaseLoginFromEnv({
        ENPHASE_CLIENT_ID: "client-id",
        ENPHASE_CLIENT_SECRET: "client-secret",
        ENPHASE_TOKEN_KEY: key,
      })
    ).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshTokenKey: Buffer.from(key, "hex"),
    });
  });

  it("is absent without them", () => {
    expect(enphaseLoginFromEnv({ ENPHASE_CLIENT_ID: "x" })).toBeUndefined();
  });
});
