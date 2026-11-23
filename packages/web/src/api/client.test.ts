import {
  csrfHeader,
  type DayTimeline,
  type Health,
  loginCodePath,
  type Settings,
  settingsPath,
} from "@charge-on-solar/shared";
import { describe, expect, it } from "vitest";
import { createApiClient, NotSignedInError } from "./client.ts";

function answering(status: number, body: unknown): typeof fetch {
  return async () => Response.json(body, { status });
}

const healthy: Health = {
  status: "ok",
  version: "0.1.0",
  startedAt: "2026-06-01T08:30:00.000Z",
};

describe("the API client", () => {
  it("fetches the server's health", async () => {
    const requested: string[] = [];
    const client = createApiClient(async (input) => {
      requested.push(String(input));
      return Response.json(healthy);
    });

    expect(await client.health()).toEqual(healthy);
    expect(requested).toEqual(["/api/health"]);
  });

  it("rejects an answer that does not match the contract", async () => {
    const client = createApiClient(answering(200, { status: "ok" }));

    await expect(client.health()).rejects.toThrow();
  });

  it("rejects an error answer with the server's message", async () => {
    const client = createApiClient(
      answering(503, { error: { status: 503, message: "Not started" } })
    );

    await expect(client.health()).rejects.toThrow("Not started");
  });
});

describe("the API client's session calls", () => {
  function recording(status: number, body?: unknown) {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return body === undefined
        ? new Response(null, { status })
        : Response.json(body, { status });
    };
    return { requests, client: createApiClient(fetchFn) };
  }

  function headersOf(init: RequestInit | undefined) {
    return new Headers(init?.headers);
  }

  it("asks for a Login code with the CSRF header", async () => {
    const { requests, client } = recording(202);

    await client.requestLoginCode("anna@example.com");

    const [request] = requests;
    expect(request?.url).toBe(loginCodePath);
    expect(request?.init?.method).toBe("POST");
    expect(headersOf(request?.init).get(csrfHeader.name)).toBe(
      csrfHeader.value
    );
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      email: "anna@example.com",
    });
  });

  it("logs in as a web client, naming the device", async () => {
    const answer = {
      user: { id: 1, name: "Anna", email: "anna@example.com" },
      signedInDeviceId: 7,
    };
    const { requests, client } = recording(200, answer);

    const session = await client.logIn({
      email: "anna@example.com",
      code: "123456",
      deviceName: "Firefox on Linux",
    });

    expect(session).toEqual(answer);
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      email: "anna@example.com",
      code: "123456",
      deviceName: "Firefox on Linux",
      client: "web",
    });
  });

  it("tells a missing session apart from other errors", async () => {
    const { client } = recording(401, {
      error: { status: 401, message: "Not signed in" },
    });

    await expect(client.session()).rejects.toBeInstanceOf(NotSignedInError);
  });

  it("saves the Settings with a PUT and answers what the server kept", async () => {
    const kept: Settings = {
      solarMode: "all-solar",
      startWindowMinutes: 5,
      stopWindowMinutes: 10,
      minimumOnTimeMinutes: 15,
      minimumOffTimeMinutes: 15,
      currentHoldMinutes: 15,
      deadBandAmps: 1,
      voltage: 230,
      mainFuseAmps: 25,
      minimumSolarWatts: 0,
      tickIntervalSeconds: 60,
    };
    const { requests, client } = recording(200, kept);

    expect(await client.saveSettings(kept)).toEqual(kept);
    expect(requests[0]?.url).toBe(settingsPath);
    expect(requests[0]?.init?.method).toBe("PUT");
    expect(headersOf(requests[0]?.init).get(csrfHeader.name)).toBe(
      csrfHeader.value
    );
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual(kept);
  });

  it("revokes a Signed-in device by its id", async () => {
    const { requests, client } = recording(204);

    await client.revokeSignedInDevice(7);

    expect(requests[0]?.url).toBe("/api/signed-in-devices/7");
    expect(requests[0]?.init?.method).toBe("DELETE");
    expect(headersOf(requests[0]?.init).get(csrfHeader.name)).toBe(
      csrfHeader.value
    );
  });

  it("reads the Signed-in devices", async () => {
    const devices = {
      devices: [
        {
          id: 7,
          deviceName: "Firefox on Linux",
          signedInAt: "2026-06-01T08:30:00.000Z",
          lastUsedAt: "2026-06-02T08:30:00.000Z",
          current: true,
        },
      ],
    };
    const { client } = recording(200, devices);

    expect(await client.signedInDevices()).toEqual(devices.devices);
  });
});

describe("the API client's Manual override", () => {
  it("posts the command with the CSRF header and answers the override", async () => {
    const accepted = {
      id: 3,
      command: "pause",
      status: "accepted",
      sentAt: "2026-06-01T12:00:00.000Z",
      user: { id: 1, name: "Sam" },
      rejection: null,
    };
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const client = createApiClient(async (input, init) => {
      requests.push({ url: String(input), init });
      return Response.json(accepted);
    });

    expect(await client.sendOverride("pause")).toEqual(accepted);
    expect(requests[0]?.url).toBe("/api/overrides");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(new Headers(requests[0]?.init?.headers).get(csrfHeader.name)).toBe(
      csrfHeader.value
    );
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      command: "pause",
    });
  });

  it("rejects with the server's reason when the charger does not allow it", async () => {
    const client = createApiClient(
      answering(409, { error: { status: 409, message: "Not charging" } })
    );

    await expect(client.sendOverride("pause")).rejects.toThrow("Not charging");
  });
});

describe("the API client's Solar calls", () => {
  const budget = { month: "2026-06", limit: 1000, used: 2, remaining: 998 };

  it("asks for a refresh with the CSRF header and answers the result", async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const answer = {
      solar: { asOf: "2026-06-01T10:00:00.000Z", solarProductionW: 4200 },
      budget,
    };
    const client = createApiClient(async (input, init) => {
      requests.push({ url: String(input), init });
      return Response.json(answer);
    });

    expect(await client.refreshSolar()).toEqual(answer);
    expect(requests[0]?.url).toBe("/api/solar/refresh");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(new Headers(requests[0]?.init?.headers).get(csrfHeader.name)).toBe(
      csrfHeader.value
    );
  });

  it("rejects a refused refresh with the server's reason", async () => {
    const client = createApiClient(
      answering(429, {
        error: { status: 429, message: "Only 61 of this month's calls…" },
      })
    );

    await expect(client.refreshSolar()).rejects.toThrow(
      "Only 61 of this month's calls…"
    );
  });

  it("reads the Enphase call budget", async () => {
    const client = createApiClient(answering(200, budget));

    expect(await client.solarBudget()).toEqual(budget);
  });
});

describe("the API client's day timeline", () => {
  it("asks for one Europe/Amsterdam day and parses its buckets", async () => {
    const requested: string[] = [];
    const answer: DayTimeline = {
      day: "2026-06-01",
      start: "2026-05-31T22:00:00.000Z",
      end: "2026-06-01T22:00:00.000Z",
      solarFetchedAt: null,
      buckets: [
        {
          start: "2026-05-31T22:00:00.000Z",
          solarProductionW: null,
          netPowerW: 350,
          chargerPowerW: 0,
        },
      ],
    };
    const client = createApiClient(async (input) => {
      requested.push(String(input));
      return Response.json(answer);
    });

    expect(await client.dayTimeline("2026-06-01")).toEqual(answer);
    expect(requested).toEqual(["/api/day-timeline?day=2026-06-01"]);
  });
});
