// The Settings as the form holds them while a User types: every number as
// the text in its field, checked with the same schema the server parses with.
import {
  type Settings,
  type SolarMode,
  settings,
} from "@charge-on-solar/shared";

export type Threshold = Exclude<keyof Settings, "solarMode">;

export type SettingsDraft = { solarMode: SolarMode } & Record<
  Threshold,
  string
>;

export type ParsedDraft =
  | { ok: true; settings: Settings }
  | { ok: false; message: string };

export function toDraft({ solarMode, ...thresholds }: Settings): SettingsDraft {
  const fields = Object.entries(thresholds).map(([name, value]) => [
    name,
    String(value),
  ]);
  return { solarMode, ...Object.fromEntries(fields) } as SettingsDraft;
}

export function parseDraft({
  solarMode,
  ...fields
}: SettingsDraft): ParsedDraft {
  const numbers = Object.entries(fields).map(([name, text]) => [
    name,
    text.trim() === "" ? Number.NaN : Number(text),
  ]);
  const parsed = settings.safeParse({
    solarMode,
    ...Object.fromEntries(numbers),
  });
  return parsed.success
    ? { ok: true, settings: parsed.data }
    : {
        ok: false,
        message: parsed.error.issues[0]?.message ?? "Check the Settings",
      };
}
