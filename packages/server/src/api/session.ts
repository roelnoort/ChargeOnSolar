import { csrfHeader, loginCodePath, loginPath } from "@charge-on-solar/shared";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { type Auth, sessionLifetime } from "../auth.ts";
import type { SignedInDeviceOfUser } from "../domain/signed-in-device.ts";

export interface SessionEnv {
  Variables: { signedIn: SignedInDeviceOfUser };
}

// The __Host- prefix makes the browser insist on Secure, Path=/ and no Domain.
const cookieName = "__Host-session";

/** The only `/api/` routes a caller may use without a session. */
const publicRoutes = new Set([`POST ${loginCodePath}`, `POST ${loginPath}`]);

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

/** Rejects a state-changing request that lacks the CSRF header. */
export const requireCsrfHeader: MiddlewareHandler = async (c, next) => {
  if (
    !safeMethods.has(c.req.method) &&
    c.req.header(csrfHeader.name) !== csrfHeader.value
  ) {
    throw new HTTPException(403, { message: "Missing CSRF header" });
  }
  await next();
};

/**
 * Lets a request through only with a live session, from the cookie or a
 * Bearer token. Every `/api/` route goes through it, apart from logging in.
 */
export function requireSession(auth: Auth): MiddlewareHandler<SessionEnv> {
  return async (c, next) => {
    if (publicRoutes.has(`${c.req.method} ${c.req.path}`)) return next();
    const bearer = bearerToken(c.req.header("authorization"));
    const token = bearer ?? getCookie(c, cookieName);
    const signedIn = token ? await auth.authenticate(token) : undefined;
    if (!token || !signedIn) {
      throw new HTTPException(401, { message: "Not signed in" });
    }
    if (!bearer) setSessionCookie(c, token);
    c.set("signedIn", signedIn);
    await next();
  };
}

function bearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1];
}

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, cookieName, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: sessionLifetime / 1000,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, cookieName, { path: "/", secure: true });
}
