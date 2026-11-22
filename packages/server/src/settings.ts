// The Settings the Shadow runner reads at every tick. Kept in app state, so
// they survive a restart; until a User changes them, the defaults hold.
import type { Settings } from "@charge-on-solar/shared";
import type { Clock } from "./clock.ts";
import { defaultShadowSettings } from "./domain/shadow/engine.ts";
import type { Storage } from "./storage/index.ts";

export interface SettingsStore {
  current(): Settings;
  update(next: Settings): Promise<void>;
}

export const defaultTickIntervalSeconds = 60;

export function defaultSettings(mainFuseAmps: number): Settings {
  return {
    ...defaultShadowSettings,
    mainFuseAmps,
    tickIntervalSeconds: defaultTickIntervalSeconds,
  };
}

export async function loadSettings({
  storage,
  clock,
  defaults,
}: {
  storage: Storage;
  clock: Clock;
  defaults: Settings;
}): Promise<SettingsStore> {
  let current = (await storage.readSettings()) ?? defaults;
  return {
    current: () => current,
    async update(next) {
      await storage.saveSettings(next, clock.now());
      current = next;
    },
  };
}
