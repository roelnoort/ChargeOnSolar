import { beforeEach, describe, expect, it } from "vitest";
import { createFakeClock, type FakeClock } from "../testing/fake-clock.ts";
import type { RefreshTokenStore } from "./client.ts";
import {
  createEnphaseCloudClient,
  enphaseRedirectUri,
  exchangeAuthorizationCode,
} from "./cloud.ts";
import productionMicro from "./fixtures/production-micro.json" with {
  type: "json",
};
import token from "./fixtures/token.json" with { type: "json" };

const systemId = "1234567";
const dayStart = new Date("2026-05-31T22:00:00.000Z");

interface SentRequest {
  method: string;
  url: URL;
  headers: Headers;
}

/** Stands in for api.enphaseenergy.com, answering with the recorded responses. */
function recordedEnphase() {
  const sent: SentRequest[] = [];
  let tokensIssued = 0;
  const rejectedTokens = new Set<string>();
  const overrides = new Map<string, () => Response>();

  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    sent.push({ method: init?.method ?? "GET", url, headers });
    const override = overrides.get(url.pathname);
    if (override) return override();
    if (url.pathname === "/oauth/token") {
      tokensIssued++;
      return Response.json({
        ...token,
        access_token: `<scrubbed-access-token-${tokensIssued}>`,
        refresh_token: `<scrubbed-refresh-token-${tokensIssued + 1}>`,
      });
    }
    const bearer = headers.get("authorization")?.replace(/^Bearer /, "");
    if (!bearer || rejectedTokens.has(bearer)) {
      return Response.json({ message: "Not Authorized" }, { status: 401 });
    }
    if (
      url.pathname === `/api/v4/systems/${systemId}/telemetry/production_micro`
    ) {
      return Response.json(productionMicro);
    }
    return new Response("", { status: 404 });
  };

  return {
    fetchFn,
    sent,
    tokenCalls: () => sent.filter((r) => r.url.pathname === "/oauth/token"),
    apiCalls: () => sent.filter((r) => r.url.pathname !== "/oauth/token"),
    revoke: (accessToken: string) => rejectedTokens.add(accessToken),
    answer: (path: string, response: () => Response) =>
      overrides.set(path, response),
  };
}

function memoryTokens(initial?: string) {
  const saved: string[] = [];
  let current = initial;
  const store: RefreshTokenStore = {
    load: async () => current,
    save: async (next) => {
      current = next;
      saved.push(next);
    },
  };
  return { store, saved, current: () => current };
}

let enphase: ReturnType<typeof recordedEnphase>;
let clock: FakeClock;
let tokens: ReturnType<typeof memoryTokens>;
let calls: number;

beforeEach(() => {
  enphase = recordedEnphase();
  clock = createFakeClock(new Date("2026-06-01T10:05:00.000Z"));
  tokens = memoryTokens("<scrubbed-refresh-token-1>");
  calls = 0;
});

function client() {
  return createEnphaseCloudClient({
    apiKey: "the-api-key",
    clientId: "the-client-id",
    clientSecret: "the-client-secret",
    systemId,
    clock,
    refreshTokens: tokens.store,
    countCall: async () => {
      calls++;
    },
    fetch: enphase.fetchFn,
  });
}

describe("the Enphase cloud client", () => {
  it("turns the recorded production telemetry into 5-minute production intervals", async () => {
    const intervals = await client().productionIntervals(dayStart);

    expect(intervals).toHaveLength(80);
    expect(intervals[0]).toEqual({
      endAt: new Date("2026-06-01T03:25:00.000Z"),
      solarProductionW: 12,
      energyWh: 1,
      devicesReporting: 14,
    });
    expect(intervals.at(-1)).toEqual({
      endAt: new Date("2026-06-01T10:00:00.000Z"),
      solarProductionW: 4200,
      energyWh: 350,
      devicesReporting: 14,
    });
  });

  it("asks for the day's intervals with the API key and the access token", async () => {
    await client().productionIntervals(dayStart);

    const [telemetry] = enphase.apiCalls();
    expect(telemetry?.url.origin).toBe("https://api.enphaseenergy.com");
    expect(telemetry?.url.searchParams.get("key")).toBe("the-api-key");
    expect(telemetry?.url.searchParams.get("start_at")).toBe("1780264800");
    expect(telemetry?.url.searchParams.get("granularity")).toBe("day");
    expect(telemetry?.headers.get("authorization")).toBe(
      "Bearer <scrubbed-access-token-1>"
    );
  });

  it("renews the access token with the stored refresh token and client credentials", async () => {
    await client().productionIntervals(dayStart);

    const [renewal] = enphase.tokenCalls();
    expect(renewal?.method).toBe("POST");
    expect(renewal?.url.searchParams.get("grant_type")).toBe("refresh_token");
    expect(renewal?.url.searchParams.get("refresh_token")).toBe(
      "<scrubbed-refresh-token-1>"
    );
    expect(renewal?.headers.get("authorization")).toBe(
      `Basic ${btoa("the-client-id:the-client-secret")}`
    );
  });

  it("stores the rotated refresh token Enphase hands back", async () => {
    await client().productionIntervals(dayStart);

    expect(tokens.saved).toEqual(["<scrubbed-refresh-token-2>"]);
  });

  it("reuses its access token until it is about to expire, then renews it", async () => {
    const enphaseClient = client();
    await enphaseClient.productionIntervals(dayStart);
    clock.advance(23 * 3600_000);
    await enphaseClient.productionIntervals(dayStart);
    expect(enphase.tokenCalls()).toHaveLength(1);

    clock.advance(3600_000);
    await enphaseClient.productionIntervals(dayStart);

    expect(enphase.tokenCalls()).toHaveLength(2);
    expect(enphase.tokenCalls()[1]?.url.searchParams.get("refresh_token")).toBe(
      "<scrubbed-refresh-token-2>"
    );
  });

  it("renews once when Enphase rejects an access token early", async () => {
    const enphaseClient = client();
    await enphaseClient.productionIntervals(dayStart);
    enphase.revoke("<scrubbed-access-token-1>");

    const intervals = await enphaseClient.productionIntervals(dayStart);

    expect(intervals).toHaveLength(80);
    expect(enphase.tokenCalls()).toHaveLength(2);
  });

  it("counts every call it makes, token calls included", async () => {
    const enphaseClient = client();
    await enphaseClient.productionIntervals(dayStart);
    await enphaseClient.productionIntervals(dayStart);

    expect(calls).toBe(3);
    expect(enphase.sent).toHaveLength(3);
  });

  it("counts a call that fails, too", async () => {
    enphase.answer(
      `/api/v4/systems/${systemId}/telemetry/production_micro`,
      () => new Response("", { status: 500 })
    );

    await expect(client().productionIntervals(dayStart)).rejects.toThrow(/500/);
    expect(calls).toBe(2);
  });

  it("fails with a pointer to the login command when it has no refresh token", async () => {
    tokens = memoryTokens(undefined);

    await expect(client().productionIntervals(dayStart)).rejects.toThrow(
      /pnpm enphase login/
    );
    expect(enphase.sent).toHaveLength(0);
  });

  it("fails when Enphase refuses the refresh token", async () => {
    enphase.answer("/oauth/token", () =>
      Response.json({ error: "invalid_grant" }, { status: 401 })
    );

    await expect(client().productionIntervals(dayStart)).rejects.toThrow(
      /refused.*401.*pnpm enphase login/i
    );
  });

  it("fails on a telemetry answer it does not recognise", async () => {
    enphase.answer(
      `/api/v4/systems/${systemId}/telemetry/production_micro`,
      () => Response.json({ unexpected: true })
    );

    await expect(client().productionIntervals(dayStart)).rejects.toThrow();
  });

  it("answers no intervals for a day without production yet", async () => {
    enphase.answer(
      `/api/v4/systems/${systemId}/telemetry/production_micro`,
      () => Response.json({ ...productionMicro, intervals: [] })
    );

    expect(await client().productionIntervals(dayStart)).toEqual([]);
  });
});

describe("the one-time Enphase authorization", () => {
  it("trades the authorization code for tokens and stores the refresh token", async () => {
    tokens = memoryTokens(undefined);

    await exchangeAuthorizationCode({
      clientId: "the-client-id",
      clientSecret: "the-client-secret",
      code: "the-code",
      refreshTokens: tokens.store,
      countCall: async () => {
        calls++;
      },
      fetch: enphase.fetchFn,
    });

    const [exchange] = enphase.tokenCalls();
    expect(exchange?.method).toBe("POST");
    expect(exchange?.url.searchParams.get("grant_type")).toBe(
      "authorization_code"
    );
    expect(exchange?.url.searchParams.get("code")).toBe("the-code");
    expect(exchange?.url.searchParams.get("redirect_uri")).toBe(
      enphaseRedirectUri
    );
    expect(exchange?.headers.get("authorization")).toBe(
      `Basic ${btoa("the-client-id:the-client-secret")}`
    );
    expect(tokens.current()).toBe("<scrubbed-refresh-token-2>");
    expect(calls).toBe(1);
  });

  it("fails with Enphase's reason when the code is refused", async () => {
    enphase.answer("/oauth/token", () =>
      Response.json(
        {
          error: "invalid_grant",
          error_description: "Invalid authorization code",
        },
        { status: 400 }
      )
    );

    await expect(
      exchangeAuthorizationCode({
        clientId: "the-client-id",
        clientSecret: "the-client-secret",
        code: "used-code",
        refreshTokens: tokens.store,
        countCall: async () => {},
        fetch: enphase.fetchFn,
      })
    ).rejects.toThrow(/Invalid authorization code/);
  });
});
