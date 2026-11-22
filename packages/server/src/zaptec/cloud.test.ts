import { beforeEach, describe, expect, it } from "vitest";
import { createFakeClock, type FakeClock } from "../testing/fake-clock.ts";
import { createZaptecCloudClient } from "./cloud.ts";
import chargerState from "./fixtures/charger-state.json" with { type: "json" };
import chargers from "./fixtures/chargers.json" with { type: "json" };
import installation from "./fixtures/installation.json" with { type: "json" };
import token from "./fixtures/token.json" with { type: "json" };

const chargerId = "00000000-0000-0000-0000-0000000c4a26";
const installationId = "00000000-0000-0000-0000-00000001a5a1";

interface SentRequest {
  method: string;
  url: string;
  headers: Headers;
  body: string;
}

/** Stands in for api.zaptec.com, answering with the recorded responses. */
function recordedZaptec() {
  const sent: SentRequest[] = [];
  let tokensIssued = 0;
  const rejectedTokens = new Set<string>();
  const overrides = new Map<string, () => Response>();

  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    sent.push({ method, url, headers, body: String(init?.body ?? "") });
    const path = new URL(url).pathname;
    const override = overrides.get(path);
    if (override) return override();
    if (path === "/oauth/token") {
      tokensIssued++;
      return Response.json({
        ...token,
        access_token: `<scrubbed-access-token-${tokensIssued}>`,
      });
    }
    const bearer = headers.get("authorization")?.replace(/^Bearer /, "");
    if (!bearer || rejectedTokens.has(bearer)) {
      return new Response("", { status: 401 });
    }
    if (path === "/api/chargers") return Response.json(chargers);
    if (path === `/api/chargers/${chargerId}/state`) {
      return Response.json(chargerState);
    }
    if (path === `/api/installation/${installationId}`) {
      return Response.json(installation);
    }
    return new Response("", { status: 404 });
  };

  return {
    fetchFn,
    sent,
    apiCalls: () =>
      sent.filter((r) => new URL(r.url).pathname !== "/oauth/token"),
    tokenCalls: () =>
      sent.filter((r) => new URL(r.url).pathname === "/oauth/token"),
    /** Zaptec forgets this token early, as it may after a restart. */
    revoke: (accessToken: string) => rejectedTokens.add(accessToken),
    answer: (path: string, response: () => Response) =>
      overrides.set(path, response),
  };
}

let zaptec: ReturnType<typeof recordedZaptec>;
let clock: FakeClock;

beforeEach(() => {
  zaptec = recordedZaptec();
  clock = createFakeClock(new Date("2026-06-01T12:00:00.000Z"));
});

function client() {
  return createZaptecCloudClient({
    username: "owner@example.com",
    password: "correct horse",
    clock,
    fetch: zaptec.fetchFn,
  });
}

describe("the Zaptec cloud client", () => {
  it("logs in with the password grant from the .env credentials", async () => {
    await client().read();

    const [login] = zaptec.tokenCalls();
    expect(login?.method).toBe("POST");
    expect(login?.url).toBe("https://api.zaptec.com/oauth/token");
    expect(login?.headers.get("content-type")).toBe(
      "application/x-www-form-urlencoded"
    );
    expect(Object.fromEntries(new URLSearchParams(login?.body))).toEqual({
      grant_type: "password",
      username: "owner@example.com",
      password: "correct horse",
    });
  });

  it("turns the recorded charger state and installation into a Reading", async () => {
    const reading = await client().read();

    expect({ ...reading, rawState: undefined }).toEqual({
      receivedAt: new Date("2026-06-01T12:00:00.000Z"),
      chargerPowerW: 2998.4,
      chargingCurrentSetA: 13,
      operationMode: 3,
      finalStopActive: false,
      nextScheduleEvent: null,
      phaseSetting: 1,
      maxCurrentA: 32,
      phaseCurrentsA: { l1: 13.012, l2: 0.031, l3: 0.027 },
      availableCurrentMode: 2,
      enabledFeatures: 3,
      surplusModeActive: false,
      rawState: undefined,
    });
  });

  it("keeps the full raw state, exactly as Zaptec sent it", async () => {
    const reading = await client().read();

    expect(JSON.parse(reading.rawState)).toEqual({
      charger: chargerState,
      installation,
    });
  });

  it("reads the same fields when Zaptec answers in camelCase", async () => {
    const camel = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(camel)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value).map(([key, inner]) => [
                key.charAt(0).toLowerCase() + key.slice(1),
                camel(inner),
              ])
            )
          : value;
    zaptec.answer(`/api/chargers/${chargerId}/state`, () =>
      Response.json(camel(chargerState))
    );
    zaptec.answer(`/api/installation/${installationId}`, () =>
      Response.json(camel(installation))
    );

    const reading = await client().read();

    expect(reading.chargerPowerW).toBe(2998.4);
    expect(reading.availableCurrentMode).toBe(2);
    expect(reading.surplusModeActive).toBe(false);
  });

  it("reads a paused charger with a schedule waiting", async () => {
    const state = (StateId: number, ValueAsString: string) => ({
      ChargerId: chargerId,
      StateId,
      Timestamp: "2026-06-01T11:00:00.00",
      ValueAsString,
    });
    const paused = [
      ...chargerState.filter((s) => ![513, 710, 718].includes(s.StateId)),
      state(710, "5"),
      state(718, "1"),
      state(763, "2026-06-02T05:00:00"),
    ];
    zaptec.answer(`/api/chargers/${chargerId}/state`, () =>
      Response.json(paused)
    );

    const reading = await client().read();

    expect(reading).toMatchObject({
      chargerPowerW: null,
      operationMode: 5,
      finalStopActive: true,
      nextScheduleEvent: "2026-06-02T05:00:00",
    });
  });

  it("sends the access token and a User-Agent with every API call", async () => {
    await client().read();

    for (const call of zaptec.apiCalls()) {
      expect(call.headers.get("authorization")).toBe(
        "Bearer <scrubbed-access-token-1>"
      );
      expect(call.headers.get("user-agent")).toMatch(/^ChargeOnSolar\/\S+$/);
    }
  });

  it("finds the charger and its installation once, not on every read", async () => {
    const zaptecClient = client();
    await zaptecClient.read();
    await zaptecClient.read();

    const listings = zaptec
      .apiCalls()
      .filter((r) => new URL(r.url).pathname === "/api/chargers");
    expect(listings).toHaveLength(1);
  });

  it("reuses its token until it is about to expire, then logs in again", async () => {
    const zaptecClient = client();
    await zaptecClient.read();
    clock.advance(3_000_000);
    await zaptecClient.read();
    expect(zaptec.tokenCalls()).toHaveLength(1);

    clock.advance(600_000);
    await zaptecClient.read();

    expect(zaptec.tokenCalls()).toHaveLength(2);
    expect(zaptec.apiCalls().at(-1)?.headers.get("authorization")).toBe(
      "Bearer <scrubbed-access-token-2>"
    );
  });

  it("logs in again once when Zaptec rejects a token early", async () => {
    const zaptecClient = client();
    await zaptecClient.read();
    zaptec.revoke("<scrubbed-access-token-1>");

    const reading = await zaptecClient.read();

    expect(reading.chargerPowerW).toBe(2998.4);
    expect(zaptec.tokenCalls()).toHaveLength(2);
  });

  it("fails when Zaptec refuses the login", async () => {
    zaptec.answer("/oauth/token", () =>
      Response.json({ error: "invalid_grant" }, { status: 400 })
    );

    await expect(client().read()).rejects.toThrow(/login.*400/i);
  });

  it("fails when the account has no charger", async () => {
    zaptec.answer("/api/chargers", () => Response.json({ Pages: 1, Data: [] }));

    await expect(client().read()).rejects.toThrow(/no charger/i);
  });

  it("fails on a state answer it does not recognise", async () => {
    zaptec.answer(`/api/chargers/${chargerId}/state`, () =>
      Response.json({ unexpected: true })
    );

    await expect(client().read()).rejects.toThrow();
  });

  it("never puts the password in a URL", async () => {
    await client().read();

    for (const request of zaptec.sent) {
      expect(request.url).not.toContain("correct");
    }
  });
});
