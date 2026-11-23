import type { ManualOverride } from "@charge-on-solar/shared";
import { describe, expect, it } from "vitest";
import {
  describeOverride,
  describeOverrideButton,
  describeSwitchBudget,
  newerOverride,
} from "./override.ts";

const resume: ManualOverride = {
  id: 3,
  command: "resume",
  status: "sending",
  sentAt: "2026-06-01T12:00:00.000Z",
  user: { id: 1, name: "Sam" },
  rejection: null,
};

describe("the Pause/Resume button", () => {
  it("pauses while charging", () => {
    expect(
      describeOverrideButton({
        availability: { command: "pause", unavailableReason: null },
        chargerStale: false,
        sending: false,
      })
    ).toEqual({ command: "pause", label: "Pause", disabledBecause: null });
  });

  it("is greyed out with the reason the server gives", () => {
    expect(
      describeOverrideButton({
        availability: {
          command: "resume",
          unavailableReason: "paused-by-schedule",
        },
        chargerStale: false,
        sending: false,
      })
    ).toEqual({
      command: "resume",
      label: "Resume",
      disabledBecause: "Paused by a schedule",
    });
  });

  it("is greyed out as Charger offline when the charger data is stale", () => {
    expect(
      describeOverrideButton({
        availability: { command: "pause", unavailableReason: null },
        chargerStale: true,
        sending: false,
      }).disabledBecause
    ).toBe("Charger offline");
  });

  it("is greyed out while this screen is still sending", () => {
    expect(
      describeOverrideButton({
        availability: { command: "pause", unavailableReason: null },
        chargerStale: false,
        sending: true,
      }).disabledBecause
    ).toBe("Waiting for the charger");
  });
});

describe("describing a Manual override", () => {
  it.each([
    ["sending", "Sending…"],
    ["accepted", "Accepted, waiting for the charger…"],
    ["confirmed", "Confirmed: the charger is charging again"],
    ["unconfirmed", "Unconfirmed: the charger did not change within a minute"],
  ] as const)("shows %s as %s", (status, text) => {
    expect(describeOverride({ ...resume, status })).toEqual({
      text,
      by: "Resume by Sam",
      failed: status === "unconfirmed",
    });
  });

  it("says a confirmed Pause paused the charger", () => {
    expect(
      describeOverride({ ...resume, command: "pause", status: "confirmed" })
        .text
    ).toBe("Confirmed: the charger is paused");
  });

  it("gives Zaptec's code and readable reason for a rejection", () => {
    expect(
      describeOverride({
        ...resume,
        status: "rejected",
        rejection: {
          code: 528,
          reason: "Charger can't resume in its current state",
        },
      })
    ).toEqual({
      text: "Rejected: Charger can't resume in its current state (code 528)",
      by: "Resume by Sam",
      failed: true,
    });
  });

  it("leaves the code out of a rejection that has none", () => {
    expect(
      describeOverride({
        ...resume,
        status: "rejected",
        rejection: { code: null, reason: "Zaptec could not be reached" },
      }).text
    ).toBe("Rejected: Zaptec could not be reached");
  });
});

describe("choosing the newer step of a Manual override", () => {
  it("takes the later override", () => {
    const later = { ...resume, id: 4 };
    expect(newerOverride(resume, later)).toBe(later);
    expect(newerOverride(later, resume)).toBe(later);
  });

  it("takes the further step of the same override, whichever came last", () => {
    const confirmed = { ...resume, status: "confirmed" as const };
    const accepted = { ...resume, status: "accepted" as const };
    expect(newerOverride(confirmed, accepted)).toBe(confirmed);
    expect(newerOverride(accepted, confirmed)).toBe(confirmed);
  });

  it("takes whichever there is", () => {
    expect(newerOverride(undefined, resume)).toBe(resume);
    expect(newerOverride(resume, undefined)).toBe(resume);
    expect(newerOverride(undefined, undefined)).toBeUndefined();
  });
});

describe("describing the Switch budget", () => {
  it("counts the switches left out of the session's", () => {
    expect(
      describeSwitchBudget({ switchesLeft: 14, switchesPerSession: 20 })
    ).toBe("14 of 20 switches left");
  });

  it("says nothing without a car connected", () => {
    expect(describeSwitchBudget(null)).toBeNull();
  });
});
