import { describe, expect, it } from "vitest";
import {
  chargerStaleAfterMs,
  dataAgeMs,
  describeApmWarning,
  describeChargerState,
  describeDataAge,
  describeGrid,
  describeNetPower,
  describePhaseSetting,
  describeZaptecMode,
  formatCurrent,
  formatSignedPower,
} from "./describe.ts";

describe("describing Net power", () => {
  it("says the house imports when Net power is positive", () => {
    expect(describeNetPower(1543)).toEqual({
      direction: "importing",
      label: "Importing",
      power: "1.54 kW",
    });
  });

  it("says the house exports when Net power is negative", () => {
    expect(describeNetPower(-850)).toEqual({
      direction: "exporting",
      label: "Exporting",
      power: "850 W",
    });
  });

  it("says neither at zero", () => {
    expect(describeNetPower(0)).toEqual({
      direction: "balanced",
      label: "Balanced",
      power: "0 W",
    });
  });
});

describe("the data age", () => {
  const snapshot = {
    at: "2026-06-01T12:00:10.000Z",
    lastSeenAt: "2026-06-01T12:00:08.000Z",
  };

  it("is the age when the server sent it, plus the time since", () => {
    expect(
      dataAgeMs({
        serverAt: snapshot.at,
        lastSeenAt: snapshot.lastSeenAt,
        receivedAt: 50_000,
        now: 53_500,
      })
    ).toBe(5_500);
  });

  it("reads as seconds, then minutes, then hours", () => {
    expect(describeDataAge(400)).toEqual({ text: "just now", stale: false });
    expect(describeDataAge(5_500)).toEqual({ text: "5 s old", stale: false });
    expect(describeDataAge(42_000)).toEqual({ text: "42 s old", stale: true });
    expect(describeDataAge(185_000)).toEqual({
      text: "3 min old",
      stale: true,
    });
    expect(describeDataAge(2 * 3_600_000 + 60_000)).toEqual({
      text: "2 h old",
      stale: true,
    });
  });

  it("calls charger data stale only after a few missed Zaptec reads", () => {
    expect(describeDataAge(45_000, chargerStaleAfterMs).stale).toBe(false);
    expect(describeDataAge(95_000, chargerStaleAfterMs)).toEqual({
      text: "1 min old",
      stale: true,
    });
  });
});

describe("describing the grid circle", () => {
  it("says power comes from the grid when importing", () => {
    expect(describeGrid(2300)).toEqual({
      label: "From grid",
      power: "2.30 kW",
    });
  });

  it("says power goes to the grid when exporting", () => {
    expect(describeGrid(-1230)).toEqual({ label: "To grid", power: "1.23 kW" });
  });

  it("says just grid at zero", () => {
    expect(describeGrid(0)).toEqual({ label: "Grid", power: "0 W" });
  });
});

describe("describing the charger", () => {
  it("names each charger state", () => {
    expect(describeChargerState("disconnected")).toBe("No car connected");
    expect(describeChargerState("connected")).toBe("Car connected, waiting");
    expect(describeChargerState("charging")).toBe("Charging");
    expect(describeChargerState("paused")).toBe("Paused");
    expect(describeChargerState("finished")).toBe("Finished");
    expect(describeChargerState("unknown")).toBe("Unknown");
  });

  it("names the Phase setting", () => {
    expect(describePhaseSetting(1)).toBe("1 phase");
    expect(describePhaseSetting(3)).toBe("3 phases");
    expect(describePhaseSetting(null)).toBe("Unknown");
  });

  it("names Zaptec's mode", () => {
    expect(describeZaptecMode("apm")).toBe("Load balancing (APM)");
    expect(describeZaptecMode("default")).toBe("Default");
    expect(describeZaptecMode("scheduled")).toBe("Scheduled");
    expect(describeZaptecMode("unknown")).toBe("Unknown");
  });

  it("formats a current to a tenth of an ampere", () => {
    expect(formatCurrent(17)).toBe("17.0 A");
    expect(formatCurrent(37.900000000000006)).toBe("37.9 A");
  });
});

describe("a signed power", () => {
  it("keeps the minus of a negative Surplus", () => {
    expect(formatSignedPower(-800)).toBe("−800 W");
    expect(formatSignedPower(4200)).toBe("4.20 kW");
  });
});

describe("the APM warning", () => {
  it("is not shown while Zaptec's load balancing (APM) is active", () => {
    expect(describeApmWarning("apm")).toBeNull();
  });

  it("says APM does not guard the main fuse in another known mode", () => {
    expect(describeApmWarning("scheduled")).toBe(
      "Zaptec's load balancing (APM) is not active: Zaptec is in Scheduled mode, so it does not guard the main fuse."
    );
  });

  it("does not claim a mode Zaptec did not report", () => {
    expect(describeApmWarning("unknown")).toBe(
      "Zaptec did not report its mode, so ChargeOnSolar cannot tell whether load balancing (APM) guards the main fuse."
    );
  });
});
