import {
  csrfHeader,
  loginCodePath,
  loginPath,
  loginResponse,
  session,
  sessionPath,
} from "@charge-on-solar/shared";
import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./testing/harness.ts";

let server: TestServer;
afterEach(async () => {
  await server?.close();
});

const anna = { name: "Anna", email: "anna@example.com" };

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return server.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [csrfHeader.name]: csrfHeader.value,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0] ?? "";
}

describe("logging in by emailed code", () => {
  it("emails a known User a code that signs this device in", async () => {
    server = await startTestServer();
    await server.addUser(anna);

    const requested = await post(loginCodePath, { email: anna.email });
    expect(requested.status).toBe(202);
    const code = server.mailer.lastCodeFor(anna.email);
    expect(code).toMatch(/^\d{6}$/);

    const loggedIn = await post(loginPath, {
      email: anna.email,
      code,
      deviceName: "Anna's phone",
    });
    expect(loggedIn.status).toBe(200);
    expect(loginResponse.parse(await loggedIn.json()).user.name).toBe("Anna");

    const current = await server.request(sessionPath, {
      headers: { cookie: cookieFrom(loggedIn) },
    });
    expect(current.status).toBe(200);
    expect(session.parse(await current.json()).user.email).toBe(anna.email);
  });
});
