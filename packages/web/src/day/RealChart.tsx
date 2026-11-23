import type { DayTimeline } from "@charge-on-solar/shared";
import { useEffect, useRef, useState } from "react";
import {
  type RealChartBucket,
  realChartBucket,
  realChartTotals,
  type SolarFetchedBucket,
  type SolarNotFetchedBucket,
} from "./real-chart.ts";

export const realChartAreas = [
  { key: "houseFromSolarW", label: "House from solar", kind: "house-solar" },
  { key: "houseFromGridW", label: "House from grid", kind: "house-grid" },
  { key: "carFromSolarW", label: "Car from solar", kind: "car-solar" },
  { key: "carFromGridW", label: "Car from grid", kind: "car-grid" },
  { key: "toGridW", label: "To grid", kind: "to-grid" },
] as const;

const plotHeight = 200;
const pad = { left: 18, right: 44, top: 8, bottom: 22 };
const smallestScaleW = 3000;

/** The width the element is drawn at, followed as it changes. */
function useWidth<T extends Element>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

type Point = [number, number];

// A Catmull-Rom style curve through the points, as in the HomeWizard chart.
function smoothLine(points: Point[]): string {
  const [first] = points;
  if (!first) return "";
  let path = `M${first[0]},${first[1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i] as Point;
    const p2 = points[i + 1] as Point;
    const p0 = points[i - 1] ?? p1;
    const p3 = points[i + 2] ?? p2;
    const t = 0.18;
    path += ` C${p1[0] + (p2[0] - p0[0]) * t},${p1[1] + (p2[1] - p0[1]) * t} ${p2[0] - (p3[0] - p1[0]) * t},${p2[1] - (p3[1] - p1[1]) * t} ${p2[0]},${p2[1]}`;
  }
  return path;
}

/** The area between two smoothed edges over the same x positions. */
function band(xs: number[], top: number[], bottom: number[]): string {
  const up = xs.map((x, i): Point => [x, top[i] ?? 0]);
  const down = xs.map((x, i): Point => [x, bottom[i] ?? 0]).reverse();
  const [downStart] = down;
  if (!downStart || up.length < 2) return "";
  const downPath = smoothLine(down).replace(/^M[^C]*/, "");
  return `${smoothLine(up)} L${downStart[0]},${downStart[1]}${downPath} Z`;
}

/** Consecutive buckets of the same kind, so a gap in the Readings breaks the areas. */
function runsOf<K extends RealChartBucket["kind"]>(
  buckets: RealChartBucket[],
  kind: K
): Extract<RealChartBucket, { kind: K }>[][] {
  const runs: Extract<RealChartBucket, { kind: K }>[][] = [];
  let run: Extract<RealChartBucket, { kind: K }>[] = [];
  for (const bucket of buckets) {
    if (bucket.kind === kind) {
      run.push(bucket as Extract<RealChartBucket, { kind: K }>);
    } else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

function stackedTotalW(bucket: RealChartBucket): number {
  switch (bucket.kind) {
    case "solar-fetched":
      return realChartAreas.reduce((sum, { key }) => sum + bucket[key], 0);
    case "solar-not-fetched":
      return Math.max(bucket.carW, bucket.fromGridW, bucket.toGridW);
    case "no-readings":
      return 0;
  }
}

const hourFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const kwhFormat = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function RealChart({
  timeline,
  now,
}: {
  timeline: DayTimeline;
  now: number;
}) {
  const { ref, width } = useWidth<HTMLDivElement>(360);
  const buckets = timeline.buckets.map(realChartBucket);
  const totals = realChartTotals(buckets);

  const dayStart = Date.parse(timeline.start);
  const dayEnd = Date.parse(timeline.end);
  const plotRight = width - pad.right;
  const x = (at: number) =>
    pad.left + ((at - dayStart) / (dayEnd - dayStart)) * (plotRight - pad.left);
  const bucketMs = (dayEnd - dayStart) / Math.max(1, buckets.length);
  const middleOf = (bucket: RealChartBucket) =>
    x(Date.parse(bucket.start) + bucketMs / 2);

  const peakW = Math.max(0, ...buckets.map(stackedTotalW));
  const scaleW = Math.max(smallestScaleW, Math.ceil(peakW / 1000) * 1000);
  const y = (watts: number) =>
    pad.top + plotHeight - (watts / scaleW) * plotHeight;
  const gridLinesW = Array.from(
    { length: scaleW / 1000 + 1 },
    (_, kw) => kw * 1000
  );

  const hoursPerTick = width < 560 ? 6 : 3;
  const hourTicks = timeline.buckets.flatMap((bucket) => {
    const label = hourFormat.format(Date.parse(bucket.start));
    const hour = Number(label.slice(0, 2));
    return label.endsWith(":00") && hour % hoursPerTick === 0
      ? [{ at: Date.parse(bucket.start), label }]
      : [];
  });

  const shownUntil = Math.min(now, dayEnd);
  const solarFetchedUntil = timeline.solarFetchedAt
    ? Math.max(dayStart, Date.parse(timeline.solarFetchedAt))
    : dayStart;
  const notFetched =
    solarFetchedUntil < shownUntil
      ? { from: x(solarFetchedUntil), to: x(shownUntil) }
      : undefined;

  function fetchedAreas(run: SolarFetchedBucket[], runIndex: number) {
    const xs = run.map(middleOf);
    const edges = realChartAreas.map((_, upTo) =>
      run.map((bucket) =>
        y(
          realChartAreas
            .slice(0, upTo)
            .reduce((sum, { key }) => sum + bucket[key], 0)
        )
      )
    );
    edges.push(run.map((bucket) => y(stackedTotalW(bucket))));
    return realChartAreas.map(({ key, kind }, i) => (
      <path
        key={`${runIndex}-${key}`}
        className={`area area-${kind}`}
        d={band(xs, edges[i + 1] ?? [], edges[i] ?? [])}
      />
    ));
  }

  function notFetchedAreas(run: SolarNotFetchedBucket[], runIndex: number) {
    const xs = run.map(middleOf);
    const floor = run.map(() => y(0));
    const car = run.map((bucket) => y(bucket.carW));
    // Net power already includes the car: only an import beyond it is the house's.
    const fromGrid = run.map((bucket) =>
      y(Math.max(bucket.carW, bucket.fromGridW))
    );
    const toGrid = run.map((bucket) => y(bucket.toGridW));
    return [
      <path
        key={`${runIndex}-car`}
        className="area area-car-unknown"
        d={band(xs, car, floor)}
      />,
      <path
        key={`${runIndex}-from-grid`}
        className="area area-house-grid area-faint"
        d={band(xs, fromGrid, car)}
      />,
      <path
        key={`${runIndex}-to-grid`}
        className="area area-to-grid area-faint"
        d={band(xs, toGrid, floor)}
      />,
    ];
  }

  return (
    <article className="card real-chart" aria-labelledby="real-chart-heading">
      <header className="real-chart-head">
        <h3 id="real-chart-heading">
          Real <span className="real-chart-subtitle">what happened</span>
        </h3>
        <dl className="real-chart-totals">
          <div>
            <dt>Car</dt>
            <dd>{kwhFormat.format(totals.carKwh)} kWh</dd>
          </div>
          {totals.carSolarShare !== null && (
            <div>
              <dt>From solar</dt>
              <dd className="total-car-solar">
                {Math.round(totals.carSolarShare * 100)}%
              </dd>
            </div>
          )}
          <div>
            <dt>From grid</dt>
            <dd className="total-from-grid">
              {kwhFormat.format(totals.fromGridKwh)} kWh
            </dd>
          </div>
          <div>
            <dt>To grid</dt>
            <dd className="total-to-grid">
              {kwhFormat.format(totals.toGridKwh)} kWh
            </dd>
          </div>
        </dl>
      </header>
      <div ref={ref} className="real-chart-plot">
        <svg
          role="img"
          aria-label="Real chart: House and Car by source, and To grid, through the day"
          viewBox={`0 0 ${width} ${pad.top + plotHeight + pad.bottom}`}
          width={width}
          height={pad.top + plotHeight + pad.bottom}
        >
          <defs>
            <pattern
              id="solar-not-fetched-hatch"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line className="hatch-line" x1="0" y1="0" x2="0" y2="6" />
            </pattern>
          </defs>
          {gridLinesW.map((watts) => (
            <g key={watts}>
              <line
                className="chart-grid-line"
                x1={pad.left}
                x2={plotRight}
                y1={y(watts)}
                y2={y(watts)}
              />
              <text className="chart-label" x={plotRight + 6} y={y(watts) + 4}>
                {watts / 1000} kW
              </text>
            </g>
          ))}
          {notFetched && (
            <rect
              className="solar-not-fetched"
              x={notFetched.from}
              y={pad.top}
              width={notFetched.to - notFetched.from}
              height={plotHeight}
              fill="url(#solar-not-fetched-hatch)"
            />
          )}
          {runsOf(buckets, "solar-fetched").map(fetchedAreas)}
          {runsOf(buckets, "solar-not-fetched").map(notFetchedAreas)}
          {notFetched && (
            <text
              className="chart-label"
              x={Math.min(
                Math.max((notFetched.from + notFetched.to) / 2, pad.left + 66),
                plotRight - 66
              )}
              y={pad.top + 14}
              textAnchor="middle"
            >
              solar not fetched yet
            </text>
          )}
          {now < dayEnd && now > dayStart && (
            <line
              className="chart-now"
              x1={x(now)}
              x2={x(now)}
              y1={pad.top}
              y2={pad.top + plotHeight}
            />
          )}
          {hourTicks.map(({ at, label }) => (
            <text
              key={at}
              className="chart-label"
              x={x(at)}
              y={pad.top + plotHeight + 16}
              textAnchor="middle"
            >
              {label}
            </text>
          ))}
        </svg>
      </div>
    </article>
  );
}
