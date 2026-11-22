import { z } from "zod";
import type { Clock } from "../clock.ts";
import type { ZaptecClient } from "./client.ts";
import { createZaptecCloudClient } from "./cloud.ts";

/** What `scripts/setup-devices.sh` writes to `.env` for Zaptec. */
const zaptecEnv = z.object({
  ZAPTEC_USERNAME: z.string().min(1),
  ZAPTEC_PASSWORD: z.string().min(1),
});

/** The Zaptec cloud client, or undefined when Zaptec is not set up. */
export function zaptecClientFromEnv(
  env: Record<string, string | undefined>,
  clock: Clock
): ZaptecClient | undefined {
  const parsed = zaptecEnv.safeParse(env);
  if (!parsed.success) return undefined;
  return createZaptecCloudClient({
    username: parsed.data.ZAPTEC_USERNAME,
    password: parsed.data.ZAPTEC_PASSWORD,
    clock,
  });
}

const mainFuseEnv = z.object({
  MAIN_FUSE_A: z.coerce.number().positive().optional(),
});

/** The main fuse rating in amperes, or undefined to use the default. */
export function mainFuseFromEnv(
  env: Record<string, string | undefined>
): number | undefined {
  return mainFuseEnv.parse(env).MAIN_FUSE_A;
}
