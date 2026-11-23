import { z } from "zod";

const shadowTickEnv = z.object({
  SHADOW_TICK_SECONDS: z.coerce.number().int().positive().optional(),
});

/** How often the Shadow runner decides, in ms, or undefined to use the default. */
export function shadowTickFromEnv(
  env: Record<string, string | undefined>
): number | undefined {
  const seconds = shadowTickEnv.parse(env).SHADOW_TICK_SECONDS;
  return seconds === undefined ? undefined : seconds * 1000;
}
