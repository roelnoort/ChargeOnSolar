import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { defaultShadowSettings } from "./engine.ts";
import { parseReadings, replayReadings, summarizeReplay } from "./replay.ts";

async function loadFixture(name: string) {
  const file = new URL(`../../testing/fixtures/${name}`, import.meta.url);
  return parseReadings(JSON.parse(await readFile(file, "utf8")));
}

describe("replaying recorded Readings", () => {
  it("makes the expected Shadow decisions over a sunny 1-phase morning", async () => {
    // Plugged in at 08:00; 2000 W of Surplus from 09:00, 500 W from 10:30;
    // unplugged at 11:00.
    const readings = await loadFixture("sunny-morning-1-phase.json");

    const steps = replayReadings(readings, defaultShadowSettings);

    expect(summarizeReplay(steps)).toEqual([
      "08:00 hold (surplus-too-low)",
      "09:03 start 6 A (surplus)",
      // The 10-min average still holds the Surplus-less minutes before 09:00.
      "09:04 hold (minimum-on-time)",
      "09:06 hold (current-hold)",
      "09:18 change-current 8 A (surplus)",
      "09:19 hold (within-dead-band)",
      "10:30 change-current 7 A (surplus)",
      "10:31 hold (current-hold)",
      "10:34 stop (surplus-too-low)",
      "10:35 hold (surplus-too-low)",
      "11:00 no-car",
    ]);
  });

  it("makes one Shadow decision per P1 meter Reading", async () => {
    const readings = await loadFixture("sunny-morning-1-phase.json");

    const steps = replayReadings(readings, defaultShadowSettings);

    expect(steps).toHaveLength(181);
    expect(steps[0]?.at).toEqual(new Date("2026-06-01T08:00:00.000Z"));
  });
});
