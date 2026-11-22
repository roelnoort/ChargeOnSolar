import { z } from "zod";
import { solarMode } from "./solar-mode.ts";

export const settingsPath = "/api/settings";

function wholeNumber(name: string, unit: string, min: number, max: number) {
  const error = `${name} must be a whole number of ${unit} from ${min} to ${max}`;
  return z
    .number({ error })
    .int({ error })
    .min(min, { error })
    .max(max, { error });
}

function decimal(name: string, unit: string, min: number, max: number) {
  const error = `${name} must be a number of ${unit} from ${min} to ${max}`;
  return z.number({ error }).min(min, { error }).max(max, { error });
}

/** The settings the Shadow engine decides by. */
export const shadowSettings = z.object({
  solarMode: z.enum(solarMode.options, {
    error: "Solar mode must be Solar only or All solar",
  }),
  startWindowMinutes: wholeNumber("The start window", "minutes", 1, 60),
  stopWindowMinutes: wholeNumber("The stop window", "minutes", 1, 60),
  minimumOnTimeMinutes: wholeNumber("The minimum on-time", "minutes", 1, 120),
  minimumOffTimeMinutes: wholeNumber("The minimum off-time", "minutes", 1, 120),
  currentHoldMinutes: wholeNumber("The current hold", "minutes", 1, 120),
  deadBandAmps: decimal("The dead band", "amperes", 0, 10),
  /** Per-phase voltage, fixed by the grid. */
  voltage: wholeNumber("The voltage", "volts", 200, 250),
  mainFuseAmps: wholeNumber("The main fuse", "amperes", 6, 100),
  minimumSolarWatts: wholeNumber("The minimum solar", "watts", 0, 20_000),
});
export type ShadowSettings = z.infer<typeof shadowSettings>;

/**
 * What `GET /api/settings` answers and `PUT /api/settings` takes: the Solar
 * mode, the Shadow engine's thresholds, and how often it decides.
 */
export const settings = shadowSettings.extend({
  tickIntervalSeconds: wholeNumber("The tick interval", "seconds", 10, 600),
});
export type Settings = z.infer<typeof settings>;
