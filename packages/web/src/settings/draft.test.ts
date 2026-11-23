import type { Settings } from "@charge-on-solar/shared";
import { describe, expect, it } from "vitest";
import { parseDraft, toDraft } from "./draft.ts";

const saved: Settings = {
  solarMode: "solar-only",
  startWindowMinutes: 5,
  stopWindowMinutes: 10,
  minimumOnTimeMinutes: 15,
  minimumOffTimeMinutes: 15,
  currentHoldMinutes: 15,
  deadBandAmps: 1,
  voltage: 230,
  mainFuseAmps: 25,
  minimumSolarWatts: 0,
  tickIntervalSeconds: 60,
};

describe("a Settings draft", () => {
  it("parses back to the Settings it was made from", () => {
    expect(parseDraft(toDraft(saved))).toEqual({ ok: true, settings: saved });
  });

  it("reads the typed numbers", () => {
    const draft = {
      ...toDraft(saved),
      solarMode: "all-solar" as const,
      deadBandAmps: "0.5",
      minimumSolarWatts: " 400 ",
    };

    expect(parseDraft(draft)).toEqual({
      ok: true,
      settings: {
        ...saved,
        solarMode: "all-solar",
        deadBandAmps: 0.5,
        minimumSolarWatts: 400,
      },
    });
  });

  it("explains a value out of range with the server's own rule", () => {
    const draft = { ...toDraft(saved), mainFuseAmps: "200" };

    expect(parseDraft(draft)).toEqual({
      ok: false,
      message: "The main fuse must be a whole number of amperes from 6 to 100",
    });
  });

  it("does not take an empty field for zero", () => {
    const draft = { ...toDraft(saved), minimumSolarWatts: "" };

    expect(parseDraft(draft)).toEqual({
      ok: false,
      message:
        "The minimum solar must be a whole number of watts from 0 to 20000",
    });
  });
});
