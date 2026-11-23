import { z } from "zod";

/** Whether the charger charges on 1 phase or on 3. */
export const phaseSetting = z.union([z.literal(1), z.literal(3)]);
export type PhaseSetting = z.infer<typeof phaseSetting>;
