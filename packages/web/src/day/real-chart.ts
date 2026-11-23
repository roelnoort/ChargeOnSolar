import type { DayTimelineBucket } from "@charge-on-solar/shared";
import type { DayPoint } from "./day-points.ts";

/** The Real chart's five areas for one bucket, in watts. */
export interface SolarFetchedBucket {
  kind: "solar-fetched";
  start: string;
  end: string;
  houseFromSolarW: number;
  houseFromGridW: number;
  carFromSolarW: number;
  carFromGridW: number;
  toGridW: number;
}

/** A bucket Enphase has not been asked for yet: only the car and the grid are known. */
export interface SolarNotFetchedBucket {
  kind: "solar-not-fetched";
  start: string;
  end: string;
  carW: number;
  fromGridW: number;
  toGridW: number;
}

export interface NoReadingsBucket {
  kind: "no-readings";
  start: string;
  end: string;
}

export type RealChartBucket =
  | SolarFetchedBucket
  | SolarNotFetchedBucket
  | NoReadingsBucket;

/**
 * Splits a bucket into what the house and the car drew from solar and from
 * the grid. Solar covers the house first, then the car; what is left goes to
 * the grid.
 */
export function realChartBucket({
  start,
  end,
  solarProductionW,
  netPowerW,
  chargerPowerW,
}: DayPoint): RealChartBucket {
  if (netPowerW === null) return { kind: "no-readings", start, end };
  const carW = chargerPowerW ?? 0;
  const fromGridW = Math.max(0, netPowerW);
  const toGridW = Math.max(0, -netPowerW);
  if (solarProductionW === null) {
    return { kind: "solar-not-fetched", start, end, carW, fromGridW, toGridW };
  }
  const houseW = Math.max(0, netPowerW + solarProductionW - carW);
  const houseFromSolarW = Math.min(solarProductionW, houseW);
  const carFromSolarW = Math.min(solarProductionW - houseFromSolarW, carW);
  return {
    kind: "solar-fetched",
    start,
    end,
    houseFromSolarW,
    houseFromGridW: houseW - houseFromSolarW,
    carFromSolarW,
    carFromGridW: carW - carFromSolarW,
    toGridW: Math.max(0, solarProductionW - houseFromSolarW - carFromSolarW),
  };
}

/**
 * The Shadow chart's areas: the house as it was, with the car drawing the
 * Shadow Charger power instead. Swapping the car changes Net power by the
 * difference, since the Surplus stays the same.
 */
export function shadowChartBucket(point: DayPoint): RealChartBucket {
  const { netPowerW, chargerPowerW, shadowChargerPowerW } = point;
  if (shadowChargerPowerW === null || netPowerW === null) {
    return { kind: "no-readings", start: point.start, end: point.end };
  }
  return realChartBucket({
    ...point,
    netPowerW: netPowerW - (chargerPowerW ?? 0) + shadowChargerPowerW,
    chargerPowerW: shadowChargerPowerW,
  });
}

/** What the Real chart's header shows for the day. */
export interface RealChartTotals {
  carKwh: number;
  /** The car's energy from solar, as a fraction of its energy where solar is known. */
  carSolarShare: number | null;
  fromGridKwh: number;
  toGridKwh: number;
}

const joulesPerKwh = 3_600_000;

export function realChartTotals(buckets: RealChartBucket[]): RealChartTotals {
  let carJ = 0;
  let carWhereSolarKnownJ = 0;
  let carFromSolarJ = 0;
  let fromGridJ = 0;
  let toGridJ = 0;
  for (const bucket of buckets) {
    const seconds = (Date.parse(bucket.end) - Date.parse(bucket.start)) / 1000;
    if (bucket.kind === "solar-fetched") {
      const car = (bucket.carFromSolarW + bucket.carFromGridW) * seconds;
      carJ += car;
      carWhereSolarKnownJ += car;
      carFromSolarJ += bucket.carFromSolarW * seconds;
      fromGridJ += (bucket.houseFromGridW + bucket.carFromGridW) * seconds;
      toGridJ += bucket.toGridW * seconds;
    } else if (bucket.kind === "solar-not-fetched") {
      carJ += bucket.carW * seconds;
      fromGridJ += bucket.fromGridW * seconds;
      toGridJ += bucket.toGridW * seconds;
    }
  }
  return {
    carKwh: carJ / joulesPerKwh,
    carSolarShare:
      carWhereSolarKnownJ > 0 ? carFromSolarJ / carWhereSolarKnownJ : null,
    fromGridKwh: fromGridJ / joulesPerKwh,
    toGridKwh: toGridJ / joulesPerKwh,
  };
}

/** Where the stretch Enphase has not been asked for yet begins, if there is one. */
export function solarNotFetchedFrom(
  buckets: DayTimelineBucket[]
): string | undefined {
  return buckets.find((bucket) => bucket.solarProductionW === null)?.start;
}

/** The top edge of each band, in watts, where solar is not fetched yet. */
export interface SolarNotFetchedStack {
  carTopW: number;
  fromGridTopW: number;
  toGridTopW: number;
}

/**
 * Stacks the car, then the import beyond it, then To grid. Net power already
 * includes the car, so only an import beyond the car is the house's.
 */
export function solarNotFetchedStack({
  carW,
  fromGridW,
  toGridW,
}: SolarNotFetchedBucket): SolarNotFetchedStack {
  const fromGridTopW = Math.max(carW, fromGridW);
  return { carTopW: carW, fromGridTopW, toGridTopW: fromGridTopW + toGridW };
}
