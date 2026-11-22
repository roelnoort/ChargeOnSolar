import { z } from "zod";

/** How strictly charging must be paid for by Surplus. */
export const solarMode = z.enum(["solar-only", "all-solar"]);
export type SolarMode = z.infer<typeof solarMode>;
