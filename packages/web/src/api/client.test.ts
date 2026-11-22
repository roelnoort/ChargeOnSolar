import {
  csrfHeader,
  type Health,
  loginCodePath,
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
