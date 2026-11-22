import { z } from "zod";

export const loginCodePath = "/api/auth/code";
export const loginPath = "/api/auth/login";
export const sessionPath = "/api/auth/session";
export const logoutPath = "/api/auth/logout";
export const signedInDevicesPath = "/api/signed-in-devices";
export const signOutEverywherePath =
  "/api/signed-in-devices/sign-out-everywhere";

export function signedInDevicePath(id: number): string {
  return `${signedInDevicesPath}/${id}`;
}

/**
 * Every state-changing request carries this header. A cross-site form or
 * image cannot set a custom header, so its absence marks a forged request.
 */
export const csrfHeader = { name: "x-chargeonsolar-csrf", value: "1" } as const;

export const userEmail = z.string().trim().toLowerCase().pipe(z.email());

/** `POST /api/auth/code`: email me a Login code. */
export const loginCodeRequest = z.object({ email: userEmail });
export type LoginCodeRequest = z.infer<typeof loginCodeRequest>;

export const loginCode = z.string().regex(/^\d{6}$/, "Enter the 6-digit code");

/**
 * How the client keeps its session: the web app in an HttpOnly cookie it
 * never sees, a native app as a Bearer token returned in the body.
 */
export const sessionClient = z.enum(["web", "native"]);
export type SessionClient = z.infer<typeof sessionClient>;

/** `POST /api/auth/login`: trade a Login code for a session. */
export const loginRequest = z.object({
  email: userEmail,
  code: loginCode,
  deviceName: z.string().trim().min(1).max(100).optional(),
  client: sessionClient.default("web"),
});
export type LoginRequest = z.input<typeof loginRequest>;

export const signedInUser = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string(),
});
export type SignedInUser = z.infer<typeof signedInUser>;

/** What `GET /api/auth/session` answers: who is signed in, on which device. */
export const session = z.object({
  user: signedInUser,
  signedInDeviceId: z.number().int(),
});
export type Session = z.infer<typeof session>;

export const loginResponse = session.extend({
  /** Only for a native client; the web app's token stays in its cookie. */
  token: z.string().optional(),
});
export type LoginResponse = z.infer<typeof loginResponse>;

export const signedInDevice = z.object({
  id: z.number().int(),
  deviceName: z.string(),
  signedInAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  current: z.boolean(),
});
export type SignedInDevice = z.infer<typeof signedInDevice>;

export const signedInDevices = z.object({ devices: z.array(signedInDevice) });
export type SignedInDevices = z.infer<typeof signedInDevices>;
