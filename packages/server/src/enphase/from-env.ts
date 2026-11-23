import { z } from "zod";
import type { EnphaseSetup } from "../server.ts";
import { createEnphaseCloudClient } from "./cloud.ts";

type Env = Record<string, string | undefined>;

/** What `scripts/setup-devices.sh` writes to `.env` for the Enphase app. */
const enphaseApp = z.object({
  ENPHASE_CLIENT_ID: z.string().min(1),
  ENPHASE_CLIENT_SECRET: z.string().min(1),
});

const enphaseSystem = enphaseApp.extend({
  ENPHASE_API_KEY: z.string().min(1),
  ENPHASE_SYSTEM_ID: z.string().min(1),
});

const tokenKey = z
  .string({ error: "ENPHASE_TOKEN_KEY is not set" })
  .regex(/^[0-9a-fA-F]{64}$/, "ENPHASE_TOKEN_KEY must be 64 hex characters");

function refreshTokenKey(env: Env): Buffer {
  const parsed = tokenKey.safeParse(env.ENPHASE_TOKEN_KEY);
  if (!parsed.success) {
    throw new Error(
      `${parsed.error.issues[0]?.message}: make one with \`openssl rand -hex 32\``
    );
  }
  return Buffer.from(parsed.data, "hex");
}

/** The Enphase cloud, or undefined while Enphase is not set up. */
export function enphaseSetupFromEnv(env: Env): EnphaseSetup | undefined {
  const parsed = enphaseSystem.safeParse(env);
  if (!parsed.success) return undefined;
  const {
    ENPHASE_API_KEY: apiKey,
    ENPHASE_CLIENT_ID: clientId,
    ENPHASE_CLIENT_SECRET: clientSecret,
    ENPHASE_SYSTEM_ID: systemId,
  } = parsed.data;
  return {
    refreshTokenKey: refreshTokenKey(env),
    client: (context) =>
      createEnphaseCloudClient({
        apiKey,
        clientId,
        clientSecret,
        systemId,
        ...context,
      }),
  };
}

export interface EnphaseLoginSettings {
  clientId: string;
  clientSecret: string;
  refreshTokenKey: Buffer;
}

/** What `pnpm enphase login` needs, or undefined while it is not in `.env`. */
export function enphaseLoginFromEnv(
  env: Env
): EnphaseLoginSettings | undefined {
  const parsed = enphaseApp.safeParse(env);
  if (!parsed.success || env.ENPHASE_TOKEN_KEY === undefined) return undefined;
  return {
    clientId: parsed.data.ENPHASE_CLIENT_ID,
    clientSecret: parsed.data.ENPHASE_CLIENT_SECRET,
    refreshTokenKey: refreshTokenKey(env),
  };
}
