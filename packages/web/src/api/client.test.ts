import type { Health } from "@charge-on-solar/shared";
import { describe, expect, it } from "vitest";
import { createApiClient } from "./client.ts";

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
