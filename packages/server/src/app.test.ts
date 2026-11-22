import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apiError, health, healthPath } from "@charge-on-solar/shared";
import { afterEach, describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import { startTestServer, type TestServer } from "./testing/harness.ts";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function signedInHeaders(on: TestServer) {
  await on.addUser({ name: "Anna", email: "anna@example.com" });
  return { headers: await on.signIn("anna@example.com") };
}

describe("GET /api/health", () => {
  it("answers with the server's version and when it started", async () => {
    server = await startTestServer({
      now: new Date("2026-06-01T08:30:00.000Z"),
    });

    const response = await server.request(
      healthPath,
      await signedInHeaders(server)
    );

    expect(response.status).toBe(200);
    expect(health.parse(await response.json())).toEqual({
      status: "ok",
      version: packageJson.version,
      startedAt: "2026-06-01T08:30:00.000Z",
    });
  });

  it("keeps reporting the start time, not the current time", async () => {
    server = await startTestServer({
      now: new Date("2026-06-01T08:30:00.000Z"),
    });
    const signedIn = await signedInHeaders(server);
    server.clock.advance(60_000);

    const body = health.parse(
      await (await server.request(healthPath, signedIn)).json()
    );

    expect(body.startedAt).toBe("2026-06-01T08:30:00.000Z");
  });
});

describe("an unknown API route", () => {
  it("answers 404 in the shared error shape", async () => {
    server = await startTestServer();

    const response = await server.request(
      "/api/no-such-thing",
      await signedInHeaders(server)
    );

    expect(response.status).toBe(404);
    expect(apiError.parse(await response.json()).error.status).toBe(404);
  });
});

describe("the web app", () => {
  let webRoot: string;
  afterEach(async () => {
    await rm(webRoot, { recursive: true, force: true });
  });

  async function builtWebApp() {
    webRoot = await mkdtemp(join(tmpdir(), "web-"));
    await mkdir(join(webRoot, "assets"));
    await writeFile(
      join(webRoot, "index.html"),
      "<title>ChargeOnSolar</title>"
    );
    await writeFile(join(webRoot, "assets", "app.js"), "console.log(1);");
    return webRoot;
  }

  it("is served at /", async () => {
    server = await startTestServer({ webRoot: await builtWebApp() });

    const response = await server.request("/");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<title>ChargeOnSolar</title>");
  });

  it("serves its assets", async () => {
    server = await startTestServer({ webRoot: await builtWebApp() });

    const response = await server.request("/assets/app.js");

    expect(await response.text()).toBe("console.log(1);");
  });

  it("answers any other page path with the app, so it can route itself", async () => {
    server = await startTestServer({ webRoot: await builtWebApp() });

    const response = await server.request("/day");

    expect(await response.text()).toContain("<title>ChargeOnSolar</title>");
  });

  it("does not swallow unknown API routes", async () => {
    server = await startTestServer({ webRoot: await builtWebApp() });

    const response = await server.request(
      "/api/no-such-thing",
      await signedInHeaders(server)
    );

    expect(response.status).toBe(404);
  });
});
