import { z } from "zod";
import type { Clock } from "../clock.ts";
import type { P1Client } from "./client.ts";
import { createHomeWizardP1Client } from "./homewizard.ts";

/** What `scripts/setup-devices.sh` writes to `.env` for the P1 meter. */
const homeWizardEnv = z.object({
  HOMEWIZARD_HOST: z.string().min(1),
  HOMEWIZARD_TOKEN: z.string().min(1),
});

/** The HomeWizard client, or undefined when the meter is not set up. */
export function p1ClientFromEnv(
  env: Record<string, string | undefined>,
  clock: Clock
): P1Client | undefined {
  const parsed = homeWizardEnv.safeParse(env);
  if (!parsed.success) return undefined;
  return createHomeWizardP1Client({
    host: parsed.data.HOMEWIZARD_HOST,
    token: parsed.data.HOMEWIZARD_TOKEN,
    clock,
  });
}
