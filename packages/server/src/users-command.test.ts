import {
  csrfHeader,
  loginCodePath,
  sessionPath,
} from "@charge-on-solar/shared";
import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./testing/harness.ts";

let server: TestServer;
afterEach(async () => {
  await server?.close();
});

describe("the users command", () => {
  it("adds a User, who can then log in", async () => {
    server = await startTestServer();

    const added = await server.usersCommand([
      "add",
      "Anna",
      "Anna@Example.com",
    ]);

    expect(added.exitCode).toBe(0);
    expect(added.output).toContain("Added Anna <anna@example.com>");
    const headers = await server.signIn("anna@example.com");
    expect((await server.request(sessionPath, { headers })).status).toBe(200);
  });

  it("refuses a second User with the same email", async () => {
    server = await startTestServer();
    await server.usersCommand(["add", "Anna", "anna@example.com"]);

    const again = await server.usersCommand([
      "add",
      "Anna B",
      "anna@example.com",
    ]);

    expect(again.exitCode).toBe(1);
    expect(again.output.join("\n")).toContain("already");
  });

  it("refuses an address that is not an email", async () => {
    server = await startTestServer();

    const result = await server.usersCommand(["add", "Anna", "anna"]);

    expect(result.exitCode).toBe(1);
  });

  it("lists the Users", async () => {
    server = await startTestServer();
    await server.usersCommand(["add", "Ben", "ben@example.com"]);
    await server.usersCommand(["add", "Anna", "anna@example.com"]);

    const listed = await server.usersCommand(["list"]);

    expect(listed.output).toEqual([
      "Anna <anna@example.com>",
      "Ben <ben@example.com>",
    ]);
  });

  it("removes a User, signing out all their devices", async () => {
    server = await startTestServer();
    await server.usersCommand(["add", "Anna", "anna@example.com"]);
    const headers = await server.signIn("anna@example.com");

    const removed = await server.usersCommand(["remove", "anna@example.com"]);

    expect(removed.exitCode).toBe(0);
    expect((await server.request(sessionPath, { headers })).status).toBe(401);
    expect((await server.usersCommand(["list"])).output).toEqual([]);
  });

  it("sends a removed User no more codes", async () => {
    server = await startTestServer();
    await server.usersCommand(["add", "Anna", "anna@example.com"]);
    await server.usersCommand(["remove", "anna@example.com"]);

    await server.request(loginCodePath, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [csrfHeader.name]: csrfHeader.value,
      },
      body: JSON.stringify({ email: "anna@example.com" }),
    });

    expect(server.mailer.sent).toHaveLength(0);
  });

  it("says so when there is no such User to remove", async () => {
    server = await startTestServer();

    const result = await server.usersCommand(["remove", "eve@example.com"]);

    expect(result.exitCode).toBe(1);
  });

  it("explains its usage when called wrongly", async () => {
    server = await startTestServer();

    const result = await server.usersCommand(["frobnicate"]);

    expect(result.exitCode).toBe(1);
    expect(result.output.join("\n")).toContain("Usage");
  });
});
