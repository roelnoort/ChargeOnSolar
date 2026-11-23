import { z } from "zod";

const shadowTickEnv = z.object({
  SHADOW_TICK_SECONDS: z.coerce.number().int().positive().optional(),
});

/**
 * How often the Shadow runner decides, in seconds, until a User changes the
 * tick interval in the Settings; undefined to use the default.
 */
export function shadowTickFromEnv(
  env: Record<string, string | undefined>
): number | undefined {
  return shadowTickEnv.parse(env).SHADOW_TICK_SECONDS;
}
