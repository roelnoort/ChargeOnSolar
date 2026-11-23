import {
  type DayTimelineBucket,
  dayTimelineBucketMs,
} from "@charge-on-solar/shared";

/** The Real chart's five areas for one bucket, in watts. */
export interface SolarFetchedBucket {
  kind: "solar-fetched";
  start: string;
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
  carW: number;
  fromGridW: number;
  toGridW: number;
}

export interface NoReadingsBucket {
  kind: "no-readings";
  start: string;
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
  solarProductionW,
  netPowerW,
  chargerPowerW,
}: DayTimelineBucket): RealChartBucket {
  if (netPowerW === null) return { kind: "no-readings", start };
  const carW = chargerPowerW ?? 0;
  const fromGridW = Math.max(0, netPowerW);
  const toGridW = Math.max(0, -netPowerW);
  if (solarProductionW === null) {
    return { kind: "solar-not-fetched", start, carW, fromGridW, toGridW };
  }
  const houseW = Math.max(0, netPowerW + solarProductionW - carW);
  const houseFromSolarW = Math.min(solarProductionW, houseW);
  const carFromSolarW = Math.min(solarProductionW - houseFromSolarW, carW);
  return {
    kind: "solar-fetched",
    start,
    houseFromSolarW,
    houseFromGridW: houseW - houseFromSolarW,
    carFromSolarW,
    carFromGridW: carW - carFromSolarW,
    toGridW: Math.max(0, solarProductionW - houseFromSolarW - carFromSolarW),
  };
}

/** What the Real chart's header shows for the day. */
export interface RealChartTotals {
  carKwh: number;
  /** The car's energy from solar, as a fraction of its energy where solar is known. */
  carSolarShare: number | null;
  fromGridKwh: number;
  toGridKwh: number;
}

const msPerHour = 3_600_000;

export function realChartTotals(buckets: RealChartBucket[]): RealChartTotals {
  let carW = 0;
  let carWhereSolarKnownW = 0;
  let carFromSolarW = 0;
  let fromGridW = 0;
  let toGridW = 0;
  for (const bucket of buckets) {
    if (bucket.kind === "solar-fetched") {
      const car = bucket.carFromSolarW + bucket.carFromGridW;
      carW += car;
      carWhereSolarKnownW += car;
      carFromSolarW += bucket.carFromSolarW;
      fromGridW += bucket.houseFromGridW + bucket.carFromGridW;
      toGridW += bucket.toGridW;
    } else if (bucket.kind === "solar-not-fetched") {
      carW += bucket.carW;
      fromGridW += bucket.fromGridW;
      toGridW += bucket.toGridW;
    }
  }
  const kwh = (watts: number) =>
    (watts * dayTimelineBucketMs) / msPerHour / 1000;
  return {
    carKwh: kwh(carW),
    carSolarShare:
      carWhereSolarKnownW > 0 ? carFromSolarW / carWhereSolarKnownW : null,
    fromGridKwh: kwh(fromGridW),
    toGridKwh: kwh(toGridW),
  };
}

/** Where the stretch Enphase has not been asked for yet begins, if there is one. */
export function solarNotFetchedFrom(
  buckets: DayTimelineBucket[]
): string | undefined {
  return buckets.find((bucket) => bucket.solarProductionW === null)?.start;
}
