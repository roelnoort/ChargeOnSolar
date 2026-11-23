import { callBudget, solarBudgetPath } from "@charge-on-solar/shared";
import { afterEach, describe, expect, it } from "vitest";
import token from "./enphase/fixtures/token.json" with { type: "json" };
import { startTestServer, type TestServer } from "./testing/harness.ts";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** Stands in for Enphase's token endpoint, answering the recorded tokens. */
function recordedTokenEndpoint() {
  const codes: (string | null)[] = [];
  const fetchFn: typeof fetch = async (input) => {
    const url = new URL(String(input));
    codes.push(url.searchParams.get("code"));
    if (url.searchParams.get("code") !== "the-code") {
      return Response.json(
        {
          error: "invalid_grant",
          error_description: "Invalid authorization code",
        },
        { status: 400 }
      );
    }
    return Response.json(token);
  };
  return { fetchFn, codes };
}

describe("pnpm enphase login", () => {
  it("without an address, says where to authorize ChargeOnSolar", async () => {
    server = await startTestServer();
    const enphase = recordedTokenEndpoint();

    const { exitCode, output } = await server.enphaseCommand(
      ["login"],
      enphase.fetchFn
    );

    expect(exitCode).toBe(0);
    expect(output.join("\n")).toContain(
      "https://api.enphaseenergy.com/oauth/authorize?response_type=code&client_id=test-client-id"
    );
    expect(enphase.codes).toEqual([]);
  });

  it("trades the code in the pasted address for the stored refresh token", async () => {
    server = await startTestServer({ withoutEnphase: true });
    const enphase = recordedTokenEndpoint();

    const { exitCode, output } = await server.enphaseCommand(
      [
        "login",
        "https://api.enphaseenergy.com/oauth/redirect_uri?code=the-code",
      ],
      enphase.fetchFn
    );

    expect({ exitCode, output }).toEqual({
      exitCode: 0,
      output: ["Enphase authorized ChargeOnSolar"],
    });
    expect(await server.enphaseRefreshTokens.load()).toBe(
      "<scrubbed-refresh-token-1>"
    );
  });

  it("takes the bare code too, and counts the call against the budget", async () => {
    server = await startTestServer();

    await server.enphaseCommand(
      ["login", "the-code"],
      recordedTokenEndpoint().fetchFn
    );

    const budget = callBudget.parse(
      await (await server.requestSignedIn(solarBudgetPath)).json()
    );
    expect(budget.used).toBe(1);
  });

  it("fails with Enphase's reason when the code is refused", async () => {
    server = await startTestServer();

    const { exitCode, output } = await server.enphaseCommand(
      ["login", "a-used-code"],
      recordedTokenEndpoint().fetchFn
    );

    expect(exitCode).toBe(1);
    expect(output.join("\n")).toMatch(/Invalid authorization code/);
    expect(await server.enphaseRefreshTokens.load()).toBeUndefined();
  });

  it("explains its usage on anything else", async () => {
    server = await startTestServer();

    const { exitCode, output } = await server.enphaseCommand(
      ["logout"],
      recordedTokenEndpoint().fetchFn
    );

    expect(exitCode).toBe(1);
    expect(output[0]).toBe("Usage:");
  });
});
