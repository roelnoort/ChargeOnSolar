import {
  csrfHeader,
  loginCodePath,
  loginPath,
  loginResponse,
  logoutPath,
  session,
  sessionPath,
  signedInDevicePath,
  signedInDevices,
  signedInDevicesPath,
  signOutEverywherePath,
} from "@charge-on-solar/shared";
import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./testing/harness.ts";

let server: TestServer;
afterEach(async () => {
  await server?.close();
});

const anna = { name: "Anna", email: "anna@example.com" };
const ben = { name: "Ben", email: "ben@example.com" };
const minute = 60_000;
const day = 24 * 60 * minute;

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

async function codeFor(email: string): Promise<string> {
  await post(loginCodePath, { email });
  const code = server.mailer.lastCodeFor(email);
  if (!code) throw new Error(`No code sent to ${email}`);
  return code;
}

function wrongCodeThan(code: string): string {
  return code === "000000" ? "000001" : "000000";
}

async function logInOnWeb(email: string, deviceName = "Browser") {
  const code = await codeFor(email);
  const response = await post(loginPath, { email, code, deviceName });
  return { cookie: cookieFrom(response) };
}

describe("asking for a Login code", () => {
  it("answers an unknown address exactly like a known one, and sends nothing", async () => {
    server = await startTestServer();
    await server.addUser(anna);

    const known = await post(loginCodePath, { email: anna.email });
    const unknown = await post(loginCodePath, { email: "eve@example.com" });

    expect(unknown.status).toBe(known.status);
    expect(await unknown.text()).toBe(await known.text());
    expect(server.mailer.sent.map(({ to }) => to)).toEqual([anna.email]);
  });

  it("treats the address case-insensitively", async () => {
    server = await startTestServer();
    await server.addUser(anna);

    await post(loginCodePath, { email: "  Anna@Example.COM " });

    expect(server.mailer.lastCodeFor(anna.email)).toMatch(/^\d{6}$/);
  });

  it("refuses something that is not an email address", async () => {
    server = await startTestServer();

    const response = await post(loginCodePath, { email: "anna" });

    expect(response.status).toBe(400);
  });

  it("limits how many codes one address can ask for, known or not", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    for (let i = 0; i < 5; i++)
      await post(loginCodePath, { email: anna.email });
    for (let i = 0; i < 5; i++) {
      await post(loginCodePath, { email: "eve@example.com" });
    }

    const known = await post(loginCodePath, { email: anna.email });
    const unknown = await post(loginCodePath, { email: "eve@example.com" });

    expect(known.status).toBe(429);
    expect(unknown.status).toBe(429);
    expect(server.mailer.sent).toHaveLength(5);
  });

  it("holds the limit when requests for one address arrive together", async () => {
    server = await startTestServer();
    await server.addUser(anna);

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        post(loginCodePath, { email: anna.email })
      )
    );

    expect(responses.filter(({ status }) => status === 429)).toHaveLength(3);
    expect(server.mailer.sent).toHaveLength(5);
  });

  it("lets the address ask again once the hour has passed", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    for (let i = 0; i < 5; i++)
      await post(loginCodePath, { email: anna.email });

    server.clock.advance(60 * minute);
    const response = await post(loginCodePath, { email: anna.email });

    expect(response.status).toBe(202);
    expect(server.mailer.sent).toHaveLength(6);
  });
});

describe("logging in with a Login code", () => {
  it("accepts the code until 10 minutes have passed", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    const code = await codeFor(anna.email);

    server.clock.advance(10 * minute - 1);
    const response = await post(loginPath, { email: anna.email, code });

    expect(response.status).toBe(200);
  });

  it("refuses the code after 10 minutes", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    const code = await codeFor(anna.email);

    server.clock.advance(10 * minute);
    const response = await post(loginPath, { email: anna.email, code });

    expect(response.status).toBe(401);
  });

  it("refuses a code that was already used", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    const code = await codeFor(anna.email);
    await post(loginPath, { email: anna.email, code });

    const again = await post(loginPath, { email: anna.email, code });

    expect(again.status).toBe(401);
  });

  it("signs in only one device when the same code arrives twice at once", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    const code = await codeFor(anna.email);

    const responses = await Promise.all([
      post(loginPath, { email: anna.email, code }),
      post(loginPath, { email: anna.email, code }),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 401]);
  });

  it("refuses an earlier code once a newer one was sent", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    const first = await codeFor(anna.email);
    const second = await codeFor(anna.email);
    if (first === second) return; // one in a million: nothing to tell apart

    const response = await post(loginPath, { email: anna.email, code: first });

    expect(response.status).toBe(401);
  });

  it("gives up on a code after 5 wrong attempts, even if the right one follows", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    const code = await codeFor(anna.email);
    for (let i = 0; i < 5; i++) {
      const wrong = await post(loginPath, {
        email: anna.email,
        code: wrongCodeThan(code),
      });
      expect(wrong.status).toBe(401);
    }

    const right = await post(loginPath, { email: anna.email, code });

    expect(right.status).toBe(401);
  });

  it("holds the cap when wrong attempts arrive together", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    const code = await codeFor(anna.email);

    const responses = await Promise.all([
      ...Array.from({ length: 5 }, () =>
        post(loginPath, { email: anna.email, code: wrongCodeThan(code) })
      ),
      post(loginPath, { email: anna.email, code }),
    ]);

    expect(responses.map(({ status }) => status)).toEqual(
      Array.from({ length: 6 }, () => 401)
    );
  });

  it("still accepts the code after 4 wrong attempts", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    const code = await codeFor(anna.email);
    for (let i = 0; i < 4; i++) {
      await post(loginPath, { email: anna.email, code: wrongCodeThan(code) });
    }

    const right = await post(loginPath, { email: anna.email, code });

    expect(right.status).toBe(200);
  });

  it("does not accept one User's code for another", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    await server.addUser(ben);
    const code = await codeFor(anna.email);
    if ((await codeFor(ben.email)) === code) return; // one in a million

    const response = await post(loginPath, { email: ben.email, code });

    expect(response.status).toBe(401);
  });

  it("sets an HttpOnly, Secure, SameSite=Strict cookie and keeps the token out of the body", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    const code = await codeFor(anna.email);

    const response = await post(loginPath, { email: anna.email, code });

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(loginResponse.parse(await response.json()).token).toBeUndefined();
  });

  it("gives a native client the token, which works as a Bearer token", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    const code = await codeFor(anna.email);

    const response = await post(loginPath, {
      email: anna.email,
      code,
      client: "native",
      deviceName: "Anna's iPhone",
    });
    const { token } = loginResponse.parse(await response.json());
    const current = await server.request(sessionPath, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.headers.get("set-cookie")).toBeNull();
    expect(current.status).toBe(200);
  });
});

describe("protecting the API", () => {
  it.each([
    sessionPath,
    "/api/health",
    "/api/live/stream",
    "/api/a-route-added-later",
  ])("refuses GET %s without a session", async (path) => {
    server = await startTestServer();

    const response = await server.request(path);

    expect(response.status).toBe(401);
  });

  it("refuses a made-up token", async () => {
    server = await startTestServer();

    const response = await server.request(sessionPath, {
      headers: { authorization: "Bearer not-a-real-token" },
    });

    expect(response.status).toBe(401);
  });

  it("rejects a state-changing request without the CSRF header", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    const { cookie } = await logInOnWeb(anna.email);

    const response = await server.request(logoutPath, {
      method: "POST",
      headers: { cookie },
    });

    expect(response.status).toBe(403);
    const stillIn = await server.request(sessionPath, { headers: { cookie } });
    expect(stillIn.status).toBe(200);
  });

  it("rejects asking for a code without the CSRF header", async () => {
    server = await startTestServer();
    await server.addUser(anna);

    const response = await server.request(loginCodePath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: anna.email }),
    });

    expect(response.status).toBe(403);
    expect(server.mailer.sent).toHaveLength(0);
  });
});

describe("a session's lifetime", () => {
  it("lasts 90 days without use", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    const headers = await server.signIn(anna.email);

    server.clock.advance(90 * day - 1);

    expect((await server.request(sessionPath, { headers })).status).toBe(200);
  });

  it("ends after 90 days without use", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    const headers = await server.signIn(anna.email);

    server.clock.advance(90 * day);

    expect((await server.request(sessionPath, { headers })).status).toBe(401);
  });

  it("starts the 90 days again at every use", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    const headers = await server.signIn(anna.email);

    server.clock.advance(60 * day);
    await server.request(sessionPath, { headers });
    server.clock.advance(60 * day);

    expect((await server.request(sessionPath, { headers })).status).toBe(200);
  });
});

describe("Signed-in devices", () => {
  async function devicesOf(headers: Record<string, string>) {
    const response = await server.request(signedInDevicesPath, { headers });
    return signedInDevices.parse(await response.json()).devices;
  }

  function del(path: string, headers: Record<string, string>) {
    return server.request(path, {
      method: "DELETE",
      headers: { ...headers, [csrfHeader.name]: csrfHeader.value },
    });
  }

  it("lists the User's devices by name, marking this one", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    await logInOnWeb(anna.email, "Laptop");
    server.clock.advance(minute);
    const phone = await logInOnWeb(anna.email, "Phone");

    const devices = await devicesOf(phone);

    expect(
      devices.map(({ deviceName, current }) => ({ deviceName, current }))
    ).toEqual([
      { deviceName: "Phone", current: true },
      { deviceName: "Laptop", current: false },
    ]);
  });

  it("does not list another User's devices", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    await server.addUser(ben);
    await logInOnWeb(ben.email, "Ben's phone");
    const annas = await logInOnWeb(anna.email, "Anna's phone");

    const devices = await devicesOf(annas);

    expect(devices.map(({ deviceName }) => deviceName)).toEqual([
      "Anna's phone",
    ]);
  });

  it("revokes another device, which is signed out at once", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    const laptop = await logInOnWeb(anna.email, "Laptop");
    const phone = await logInOnWeb(anna.email, "Phone");
    const laptopId = (await devicesOf(phone)).find(
      ({ deviceName }) => deviceName === "Laptop"
    )?.id;

    const revoked = await del(signedInDevicePath(laptopId ?? 0), phone);

    expect(revoked.status).toBe(204);
    const asLaptop = await server.request(sessionPath, { headers: laptop });
    expect(asLaptop.status).toBe(401);
    const asPhone = await server.request(sessionPath, { headers: phone });
    expect(asPhone.status).toBe(200);
  });

  it("cannot revoke another User's device", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    await server.addUser(ben);
    const bens = await logInOnWeb(ben.email, "Ben's phone");
    const bensId = (await devicesOf(bens))[0]?.id ?? 0;
    const annas = await logInOnWeb(anna.email);

    const response = await del(signedInDevicePath(bensId), annas);

    expect(response.status).toBe(404);
    expect((await server.request(sessionPath, { headers: bens })).status).toBe(
      200
    );
  });

  it("signs out everywhere, this device too, leaving other Users signed in", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    await server.addUser(ben);
    const laptop = await logInOnWeb(anna.email, "Laptop");
    const phone = await server.signIn(anna.email);
    const bens = await logInOnWeb(ben.email);

    const response = await server.request(signOutEverywherePath, {
      method: "POST",
      headers: { ...phone, [csrfHeader.name]: csrfHeader.value },
    });

    expect(response.status).toBe(204);
    for (const headers of [laptop, phone]) {
      expect((await server.request(sessionPath, { headers })).status).toBe(401);
    }
    expect((await server.request(sessionPath, { headers: bens })).status).toBe(
      200
    );
  });

  it("signs out just this device", async () => {
    server = await startTestServer();
    await server.addUser(anna);
    const laptop = await logInOnWeb(anna.email, "Laptop");
    const phone = await logInOnWeb(anna.email, "Phone");

    const response = await server.request(logoutPath, {
      method: "POST",
      headers: { ...phone, [csrfHeader.name]: csrfHeader.value },
    });

    expect(response.status).toBe(204);
    expect((await server.request(sessionPath, { headers: phone })).status).toBe(
      401
    );
    expect(
      (await server.request(sessionPath, { headers: laptop })).status
    ).toBe(200);
  });
});
