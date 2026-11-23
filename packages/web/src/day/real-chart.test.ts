import { describe, expect, it } from "vitest";
import type { DayPoint } from "./day-points.ts";
import {
  type RealChartBucket,
  realChartBucket,
  realChartTotals,
  shadowChartBucket,
  solarNotFetchedFrom,
  solarNotFetchedStack,
} from "./real-chart.ts";

function bucket(power: Partial<DayPoint>): DayPoint {
  return {
    start: "2026-06-01T10:00:00.000Z",
    end: "2026-06-01T10:05:00.000Z",
    solarProductionW: null,
    netPowerW: null,
    chargerPowerW: null,
    shadowChargerPowerW: null,
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
      end: "2026-06-01T10:05:00.000Z",
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
      end: "2026-06-01T10:05:00.000Z",
      carW: 1400,
      fromGridW: 0,
      toGridW: 600,
    });
  });

  it("has nothing to show without a P1 Reading", () => {
    expect(
      realChartBucket(bucket({ solarProductionW: 900, chargerPowerW: 0 }))
    ).toEqual({
      kind: "no-readings",
      start: "2026-06-01T10:00:00.000Z",
      end: "2026-06-01T10:05:00.000Z",
    });
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

describe("splitting a bucket into the Shadow chart's areas", () => {
  it("keeps the house as it was and puts the Shadow Charger power in the car's place", () => {
    // House: -1000 + 4000 - 1000 = 2000 W, all from solar; 2000 W left for the car.
    expect(
      shadowChartBucket(
        bucket({
          solarProductionW: 4000,
          netPowerW: -1000,
          chargerPowerW: 1000,
          shadowChargerPowerW: 3000,
        })
      )
    ).toEqual({
      kind: "solar-fetched",
      start: "2026-06-01T10:00:00.000Z",
      end: "2026-06-01T10:05:00.000Z",
      houseFromSolarW: 2000,
      houseFromGridW: 0,
      carFromSolarW: 2000,
      carFromGridW: 1000,
      toGridW: 0,
    });
  });

  it("works out the grid from the Surplus where solar is not fetched yet", () => {
    // Surplus: 0 - (-600) = 600 W; the Shadow car would draw 1380 W of it and more.
    expect(
      shadowChartBucket(
        bucket({ netPowerW: -600, chargerPowerW: 0, shadowChargerPowerW: 1380 })
      )
    ).toMatchObject({
      kind: "solar-not-fetched",
      carW: 1380,
      fromGridW: 780,
      toGridW: 0,
    });
  });

  it("has nothing to show without a Shadow decision", () => {
    expect(
      shadowChartBucket(bucket({ netPowerW: -600, chargerPowerW: 0 })).kind
    ).toBe("no-readings");
  });
});

describe("the Real chart's day totals", () => {
  const start = "2026-06-01T10:00:00.000Z";
  const end = "2026-06-01T10:05:00.000Z";
  // 12 buckets of 5 minutes make an hour: 12 × 1000 W is 1 kWh.
  const hourOf = (b: RealChartBucket) => Array.from({ length: 12 }, () => b);

  it("adds up the car's energy, its share from solar, and the energy from and to the grid", () => {
    const totals = realChartTotals([
      ...hourOf({
        kind: "solar-fetched",
        start,
        end,
        houseFromSolarW: 500,
        houseFromGridW: 0,
        carFromSolarW: 1500,
        carFromGridW: 500,
        toGridW: 0,
      }),
      ...hourOf({
        kind: "solar-fetched",
        start,
        end,
        houseFromSolarW: 0,
        houseFromGridW: 1000,
        carFromSolarW: 0,
        carFromGridW: 0,
        toGridW: 0,
      }),
      ...hourOf({
        kind: "solar-fetched",
        start,
        end,
        houseFromSolarW: 300,
        houseFromGridW: 0,
        carFromSolarW: 0,
        carFromGridW: 0,
        toGridW: 2000,
      }),
      ...hourOf({ kind: "no-readings", start, end }),
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
        end,
        houseFromSolarW: 0,
        houseFromGridW: 0,
        carFromSolarW: 1000,
        carFromGridW: 1000,
        toGridW: 0,
      }),
      ...hourOf({
        kind: "solar-not-fetched",
        start,
        end,
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

  it("weighs a bucket cut short by how long it lasted", () => {
    const totals = realChartTotals([
      {
        kind: "solar-not-fetched",
        start,
        end: "2026-06-01T10:01:00.000Z",
        carW: 6000,
        fromGridW: 0,
        toGridW: 0,
      },
    ]);

    expect(totals.carKwh).toBeCloseTo(0.1);
  });

  it("has no solar share when the car drew nothing where solar is known", () => {
    expect(
      realChartTotals(
        hourOf({
          kind: "solar-not-fetched",
          start,
          end,
          carW: 3000,
          fromGridW: 3000,
          toGridW: 0,
        })
      ).carSolarShare
    ).toBeNull();
  });
});

describe("where the Real chart hatches solar as not fetched yet", () => {
  const at = (minutes: number) =>
    new Date(
      Date.parse("2026-06-01T10:00:00.000Z") + minutes * 60_000
    ).toISOString();

  it("starts at the first bucket without Solar production", () => {
    expect(
      solarNotFetchedFrom([
        bucket({ start: at(0), solarProductionW: 1200 }),
        bucket({ start: at(5), solarProductionW: 0 }),
        bucket({ start: at(10), solarProductionW: null }),
        bucket({ start: at(15), solarProductionW: null }),
      ])
    ).toBe(at(10));
  });

  it("hatches nothing once the whole day has Solar production", () => {
    expect(
      solarNotFetchedFrom([
        bucket({ start: at(0), solarProductionW: 1200 }),
        bucket({ start: at(5), solarProductionW: 0 }),
      ])
    ).toBeUndefined();
  });
});

describe("stacking the Real chart where solar is not fetched yet", () => {
  const notFetched = (power: {
    carW: number;
    fromGridW: number;
    toGridW: number;
  }) =>
    ({
      kind: "solar-not-fetched",
      start: "2026-06-01T10:00:00.000Z",
      end: "2026-06-01T10:05:00.000Z",
      ...power,
    }) as const;

  it("stacks To grid on top of the car", () => {
    expect(
      solarNotFetchedStack(
        notFetched({ carW: 2000, fromGridW: 0, toGridW: 800 })
      )
    ).toEqual({ carTopW: 2000, fromGridTopW: 2000, toGridTopW: 2800 });
  });

  it("shows only the import beyond the car above it", () => {
    expect(
      solarNotFetchedStack(
        notFetched({ carW: 2000, fromGridW: 2600, toGridW: 0 })
      )
    ).toEqual({ carTopW: 2000, fromGridTopW: 2600, toGridTopW: 2600 });
  });
});
