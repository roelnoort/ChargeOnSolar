import {
  type LoginResponse,
  loginCodePath,
  loginCodeRequest,
  loginPath,
  loginRequest,
  logoutPath,
  type Session,
  type SignedInDevices,
  sessionPath,
  signedInDevicesPath,
  signOutEverywherePath,
} from "@charge-on-solar/shared";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Auth } from "../auth.ts";
import type { SignedInDevice } from "../domain/signed-in-device.ts";
import type { Storage } from "../storage/index.ts";
import { parseBody, parseOr400 } from "./parse.ts";
import {
  clearSessionCookie,
  type SessionEnv,
  setSessionCookie,
} from "./session.ts";

const unknownDeviceName = "Unknown device";
const deviceId = z.coerce.number().int().positive();

export function authRoutes(
  app: Hono<SessionEnv>,
  { auth, storage }: { auth: Auth; storage: Storage }
) {
  app.post(loginCodePath, async (c) => {
    const { email } = await parseBody(c, loginCodeRequest);
    const outcome = await auth.requestLoginCode(email);
    if (outcome === "rate-limited") {
      throw new HTTPException(429, {
        message: "Too many codes asked for this address. Try again later.",
      });
    }
    return c.body(null, 202);
  });

  app.post(loginPath, async (c) => {
    const { email, code, deviceName, client } = await parseBody(
      c,
      loginRequest
    );
    const loggedIn = await auth.logIn({
      email,
      code,
      deviceName: deviceName ?? unknownDeviceName,
    });
    if (!loggedIn) {
      throw new HTTPException(401, {
        message: "That code is wrong or no longer valid",
      });
    }
    const body: LoginResponse = {
      user: loggedIn.user,
      signedInDeviceId: loggedIn.device.id,
    };
    if (client === "native") return c.json({ ...body, token: loggedIn.token });
    setSessionCookie(c, loggedIn.token);
    return c.json(body);
  });

  app.get(sessionPath, (c) => {
    const { user, device } = c.get("signedIn");
    const body: Session = { user, signedInDeviceId: device.id };
    return c.json(body);
  });

  app.post(logoutPath, async (c) => {
    const { user, device } = c.get("signedIn");
    await storage.removeSignedInDevice(user.id, device.id);
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  app.get(signedInDevicesPath, async (c) => {
    const { user, device: current } = c.get("signedIn");
    const devices = await auth.signedInDevicesOf(user);
    const body: SignedInDevices = {
      devices: devices.map((device) => toContract(device, current.id)),
    };
    return c.json(body);
  });

  app.post(signOutEverywherePath, async (c) => {
    const { user } = c.get("signedIn");
    await storage.removeAllSignedInDevices(user.id);
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  app.delete(`${signedInDevicesPath}/:id`, async (c) => {
    const id = parseOr400(deviceId, c.req.param("id"));
    const { user, device: current } = c.get("signedIn");
    // Scoped to the signed-in User: nobody revokes another User's device.
    const removed = await storage.removeSignedInDevice(user.id, id);
    if (!removed) {
      throw new HTTPException(404, { message: "No such signed-in device" });
    }
    if (id === current.id) clearSessionCookie(c);
    return c.body(null, 204);
  });
}

function toContract(device: SignedInDevice, currentId: number) {
  return {
    id: device.id,
    deviceName: device.deviceName,
    signedInAt: device.signedInAt.toISOString(),
    lastUsedAt: device.lastUsedAt.toISOString(),
    current: device.id === currentId,
  };
}
