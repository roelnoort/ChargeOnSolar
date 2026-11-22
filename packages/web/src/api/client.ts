import {
  apiError,
  csrfHeader,
  type Health,
  health,
  healthPath,
  type LoginRequest,
  loginCodePath,
  loginPath,
  loginResponse,
  logoutPath,
  type Session,
  type SignedInDevice,
  session,
  sessionPath,
  signedInDevicePath,
  signedInDevices,
  signedInDevicesPath,
  signOutEverywherePath,
} from "@charge-on-solar/shared";
import { z } from "zod";

/** The server answered 401: this device has no live session. */
export class NotSignedInError extends Error {}

const noBody = z.unknown();

/** Calls the server's API, parsing every answer with the shared contract. */
export function createApiClient(fetchFn: typeof fetch = fetch) {
  async function call<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (method !== "GET") headers[csrfHeader.name] = csrfHeader.value;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetchFn(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const answer: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = apiError.safeParse(answer);
      const message = error.success
        ? error.data.error.message
        : `${method} ${path} answered ${response.status}`;
      throw response.status === 401
        ? new NotSignedInError(message)
        : new Error(message);
    }
    return schema.parse(answer);
  }

  return {
    health: (): Promise<Health> => call("GET", healthPath, health),
    session: (): Promise<Session> => call("GET", sessionPath, session),
    requestLoginCode: async (email: string): Promise<void> => {
      await call("POST", loginCodePath, noBody, { email });
    },
    logIn: async (attempt: Omit<LoginRequest, "client">): Promise<Session> => {
      const { user, signedInDeviceId } = await call(
        "POST",
        loginPath,
        loginResponse,
        { ...attempt, client: "web" }
      );
      return { user, signedInDeviceId };
    },
    logOut: async (): Promise<void> => {
      await call("POST", logoutPath, noBody);
    },
    signedInDevices: async (): Promise<SignedInDevice[]> =>
      (await call("GET", signedInDevicesPath, signedInDevices)).devices,
    revokeSignedInDevice: async (id: number): Promise<void> => {
      await call("DELETE", signedInDevicePath(id), noBody);
    },
    signOutEverywhere: async (): Promise<void> => {
      await call("POST", signOutEverywherePath, noBody);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
