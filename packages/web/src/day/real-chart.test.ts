import type { DayTimelineBucket } from "@charge-on-solar/shared";
import { describe, expect, it } from "vitest";
import {
  type RealChartBucket,
  realChartBucket,
  realChartTotals,
} from "./real-chart.ts";

function bucket(power: Partial<DayTimelineBucket>): DayTimelineBucket {
  return {
    start: "2026-06-01T10:00:00.000Z",
    solarProductionW: null,
    netPowerW: null,
    chargerPowerW: null,
    ...power,
  };
}

describe("splitting a bucket into the Real chart's areas", () => {
  it("lets solar cover the house first, then the car, and sends the rest to the grid", () => {
    // House: -1000 + 4000 - 1500 = 1500 W.
    expect(
      realChartBucket(
        bucket({
          solarProductionW: 4000,
          netPowerW: -1000,
          chargerPowerW: 1500,
        })
      )
    ).toEqual({
      kind: "solar-fetched",
      start: "2026-06-01T10:00:00.000Z",
      houseFromSolarW: 1500,
      houseFromGridW: 0,
      carFromSolarW: 1500,
      carFromGridW: 0,
      toGridW: 1000,
    });
  });

  it("takes the car from the grid once solar has covered the house", () => {
    // House: 2500 + 1000 - 3000 = 500 W.
    expect(
      realChartBucket(
        bucket({ solarProductionW: 1000, netPowerW: 2500, chargerPowerW: 3000 })
      )
    ).toMatchObject({
      houseFromSolarW: 500,
      houseFromGridW: 0,
      carFromSolarW: 500,
      carFromGridW: 2500,
      toGridW: 0,
    });
  });

  it("takes the house from the grid when solar is short", () => {
    // House: 1800 + 200 - 0 = 2000 W.
    expect(
      realChartBucket(
        bucket({ solarProductionW: 200, netPowerW: 1800, chargerPowerW: 0 })
      )
    ).toMatchObject({
      houseFromSolarW: 200,
      houseFromGridW: 1800,
      carFromSolarW: 0,
      carFromGridW: 0,
      toGridW: 0,
    });
  });

  it("shows only the car and the grid where solar is not fetched yet", () => {
    expect(
      realChartBucket(bucket({ netPowerW: -600, chargerPowerW: 1400 }))
    ).toEqual({
      kind: "solar-not-fetched",
      start: "2026-06-01T10:00:00.000Z",
      carW: 1400,
      fromGridW: 0,
      toGridW: 600,
    });
  });

  it("has nothing to show without a P1 Reading", () => {
    expect(
      realChartBucket(bucket({ solarProductionW: 900, chargerPowerW: 0 }))
    ).toEqual({ kind: "no-readings", start: "2026-06-01T10:00:00.000Z" });
  });

  it("counts a bucket without a charger Reading as the car drawing nothing", () => {
    expect(
      realChartBucket(bucket({ solarProductionW: 900, netPowerW: -400 }))
    ).toMatchObject({
      houseFromSolarW: 500,
      carFromSolarW: 0,
      carFromGridW: 0,
      toGridW: 400,
    });
  });
});

describe("the Real chart's day totals", () => {
  const start = "2026-06-01T10:00:00.000Z";
  // 12 buckets of 5 minutes make an hour: 12 × 1000 W is 1 kWh.
  const hourOf = (b: RealChartBucket) => Array.from({ length: 12 }, () => b);

  it("adds up the car's energy, its share from solar, and the energy from and to the grid", () => {
    const totals = realChartTotals([
      ...hourOf({
        kind: "solar-fetched",
        start,
        houseFromSolarW: 500,
        houseFromGridW: 0,
        carFromSolarW: 1500,
        carFromGridW: 500,
        toGridW: 0,
      }),
      ...hourOf({
        kind: "solar-fetched",
        start,
        houseFromSolarW: 0,
        houseFromGridW: 1000,
        carFromSolarW: 0,
        carFromGridW: 0,
        toGridW: 0,
      }),
      ...hourOf({
        kind: "solar-fetched",
        start,
        houseFromSolarW: 300,
        houseFromGridW: 0,
        carFromSolarW: 0,
        carFromGridW: 0,
        toGridW: 2000,
      }),
      ...hourOf({ kind: "no-readings", start }),
    ]);

    expect(totals).toEqual({
      carKwh: 2,
      carSolarShare: 0.75,
      fromGridKwh: 1.5,
      toGridKwh: 2,
    });
  });

  it("counts the car and the grid where solar is not fetched yet, but not towards the solar share", () => {
    const totals = realChartTotals([
      ...hourOf({
        kind: "solar-fetched",
        start,
        houseFromSolarW: 0,
        houseFromGridW: 0,
        carFromSolarW: 1000,
        carFromGridW: 1000,
        toGridW: 0,
      }),
      ...hourOf({
        kind: "solar-not-fetched",
        start,
        carW: 3000,
        fromGridW: 500,
        toGridW: 0,
      }),
    ]);

    expect(totals).toEqual({
      carKwh: 5,
      carSolarShare: 0.5,
      fromGridKwh: 1.5,
      toGridKwh: 0,
    });
  });

  it("has no solar share when the car drew nothing where solar is known", () => {
    expect(
      realChartTotals(
        hourOf({
          kind: "solar-not-fetched",
          start,
          carW: 3000,
          fromGridW: 3000,
          toGridW: 0,
        })
      ).carSolarShare
    ).toBeNull();
  });
});
