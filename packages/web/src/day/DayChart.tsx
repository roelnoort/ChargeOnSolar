import {
  type DayOverride,
  type DayTimeline,
  overrideCommandLabels,
  type ShadowSwitch,
} from "@charge-on-solar/shared";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { amsterdamClockTime } from "../amsterdam-clock.ts";
import { labelRows } from "./label-rows.ts";
import {
  type RealChartBucket,
  realChartTotals,
  type SolarFetchedBucket,
  type SolarNotFetchedBucket,
  solarNotFetchedStack,
} from "./real-chart.ts";
import { band } from "./smooth-band.ts";

export const realChartAreas = [
  { key: "houseFromSolarW", label: "House from solar", kind: "house-solar" },
  { key: "houseFromGridW", label: "House from grid", kind: "house-grid" },
  { key: "carFromSolarW", label: "Car from solar", kind: "car-solar" },
  { key: "carFromGridW", label: "Car from grid", kind: "car-grid" },
  { key: "toGridW", label: "To grid", kind: "to-grid" },
] as const;

const labelRowCount = 3;
const labelRowHeight = 14;
const plotHeight = 200;
const pad = {
  left: 18,
  right: 44,
  top: 6 + labelRowCount * labelRowHeight,
  bottom: 22,
};
const smallestScaleW = 3000;
// Roughly the width of one character of an 11 px chart label.
const labelCharWidth = 6.2;

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
      return solarNotFetchedStack(bucket).toGridTopW;
    case "no-readings":
      return 0;
  }
}

/** The kW scale that fits every bucket of all the charts, in whole kW. */
export function chartScaleW(...charts: RealChartBucket[][]): number {
  const peakW = Math.max(0, ...charts.flat().map(stackedTotalW));
  return Math.max(smallestScaleW, Math.ceil(peakW / 1000) * 1000);
}

const oneDecimal = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const kw = (watts: number) => `${oneDecimal.format(watts / 1000)} kW`;

function describeBucket(bucket: RealChartBucket | undefined, empty: string) {
  switch (bucket?.kind) {
    case "solar-fetched":
      return realChartAreas.map(
        ({ key, label }) => `${label} ${kw(bucket[key])}`
      );
    case "solar-not-fetched":
      return [
        `Car ${kw(bucket.carW)}`,
        `From grid ${kw(bucket.fromGridW)}`,
        `To grid ${kw(bucket.toGridW)}`,
      ];
    default:
      return [empty];
  }
}

const switchArrows = { start: "▲", stop: "▼" } as const;
const overrideFlag = "⚑";

function switchLabel({ kind, currentA }: ShadowSwitch) {
  const arrow = switchArrows[kind];
  return currentA === null ? arrow : `${arrow} ${Math.round(currentA)} A`;
}

function overrideLabel({ command, userName }: DayOverride) {
  return `${overrideFlag} ${overrideCommandLabels[command]} · ${userName}`;
}

export interface DayChartProps {
  name: "real" | "shadow";
  title: string;
  subtitle: string;
  timeline: DayTimeline;
  buckets: RealChartBucket[];
  /** The top of the kW scale, shared by the charts of the day. */
  scaleW: number;
  now: number;
  /** Where Enphase has not been asked for Solar production yet, if anywhere. */
  solarNotFetchedFrom: number | undefined;
  switches: ShadowSwitch[];
  overrides: DayOverride[];
  /** The moment being looked at, on whichever chart. */
  hoverAt: number | undefined;
  onHover: (at: number | undefined) => void;
  /** Shown in the details where the chart has nothing at the moment looked at. */
  emptyDetails: string;
}

export function DayChart({
  name,
  title,
  subtitle,
  timeline,
  buckets,
  scaleW,
  now,
  solarNotFetchedFrom,
  switches,
  overrides,
  hoverAt,
  onHover,
  emptyDetails,
}: DayChartProps) {
  const { ref, width } = useWidth<HTMLDivElement>(360);
  const totals = realChartTotals(buckets);
  const headingId = `${name}-chart-heading`;
  const hatchId = `${name}-solar-not-fetched-hatch`;

  const dayStart = Date.parse(timeline.start);
  const dayEnd = Date.parse(timeline.end);
  const plotRight = width - pad.right;
  const x = (at: number) =>
    pad.left + ((at - dayStart) / (dayEnd - dayStart)) * (plotRight - pad.left);
  const middleOf = (bucket: RealChartBucket) =>
    x((Date.parse(bucket.start) + Date.parse(bucket.end)) / 2);

  const y = (watts: number) =>
    pad.top + plotHeight - (watts / scaleW) * plotHeight;
  const gridLinesW = Array.from(
    { length: scaleW / 1000 + 1 },
    (_, kw) => kw * 1000
  );

  const hoursPerTick = width < 560 ? 6 : 3;
  const hourTicks = timeline.buckets.flatMap((bucket) => {
    const label = amsterdamClockTime.format(Date.parse(bucket.start));
    const hour = Number(label.slice(0, 2));
    return label.endsWith(":00") && hour % hoursPerTick === 0
      ? [{ at: Date.parse(bucket.start), label }]
      : [];
  });

  const shownUntil = Math.min(now, dayEnd);
  const notFetched =
    solarNotFetchedFrom !== undefined && solarNotFetchedFrom < shownUntil
      ? { from: x(solarNotFetchedFrom), to: x(shownUntil) }
      : undefined;

  const labels = [
    ...overrides.map((override) => ({
      key: `override-${override.id}`,
      at: Date.parse(override.sentAt),
      text: overrideLabel(override),
      glyph: overrideFlag,
      className: "chart-flag",
    })),
    ...switches.map((shadowSwitch) => ({
      key: `${shadowSwitch.kind}-${shadowSwitch.at}`,
      at: Date.parse(shadowSwitch.at),
      text: switchLabel(shadowSwitch),
      glyph: switchArrows[shadowSwitch.kind],
      className: `chart-marker chart-marker-${shadowSwitch.kind}`,
    })),
  ].sort((a, b) => a.at - b.at);
  const rows = labelRows(
    labels.map(({ at, text }) => ({
      x: x(at),
      width: (text.length + 1) * labelCharWidth,
    })),
    labelRowCount
  );

  const hovered =
    hoverAt === undefined
      ? undefined
      : buckets.find(
          (bucket) =>
            Date.parse(bucket.start) <= hoverAt &&
            hoverAt < Date.parse(bucket.end)
        );
  const hoveredLabels = hovered
    ? labels.filter(
        ({ at }) =>
          Date.parse(hovered.start) <= at && at < Date.parse(hovered.end)
      )
    : [];

  function hoverFrom(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - box.left) / box.width) * width;
    const share = (svgX - pad.left) / (plotRight - pad.left);
    onHover(
      share < 0 || share > 1
        ? undefined
        : dayStart + share * (dayEnd - dayStart)
    );
  }

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
    const stacks = run.map(solarNotFetchedStack);
    const floor = run.map(() => y(0));
    const car = stacks.map((stack) => y(stack.carTopW));
    const fromGrid = stacks.map((stack) => y(stack.fromGridTopW));
    const toGrid = stacks.map((stack) => y(stack.toGridTopW));
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
        d={band(xs, toGrid, fromGrid)}
      />,
    ];
  }

  return (
    <article
      className={`card day-chart ${name}-chart`}
      aria-labelledby={headingId}
    >
      <header className="day-chart-head">
        <h3 id={headingId}>
          {title} <span className="day-chart-subtitle">{subtitle}</span>
        </h3>
        <dl className="day-chart-totals">
          <div>
            <dt>Car</dt>
            <dd>{oneDecimal.format(totals.carKwh)} kWh</dd>
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
              {oneDecimal.format(totals.fromGridKwh)} kWh
            </dd>
          </div>
          <div>
            <dt>To grid</dt>
            <dd className="total-to-grid">
              {oneDecimal.format(totals.toGridKwh)} kWh
            </dd>
          </div>
        </dl>
      </header>
      <div ref={ref} className="day-chart-plot">
        <svg
          role="img"
          aria-label={`${title} chart: House and Car by source, and To grid, through the day`}
          viewBox={`0 0 ${width} ${pad.top + plotHeight + pad.bottom}`}
          width={width}
          height={pad.top + plotHeight + pad.bottom}
          onPointerMove={hoverFrom}
          onPointerDown={hoverFrom}
          onPointerLeave={() => onHover(undefined)}
        >
          <defs>
            <pattern
              id={hatchId}
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
              fill={`url(#${hatchId})`}
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
          {labels.map(({ key, at, text, glyph, className }, index) => {
            const row = rows[index];
            // Without room for the whole label, only its arrow or flag shows, on the bottom row.
            const labelY =
              4 + ((row ?? labelRowCount - 1) + 1) * labelRowHeight - 3;
            return (
              <g key={key} className={className}>
                <line
                  className="chart-label-pole"
                  x1={x(at)}
                  x2={x(at)}
                  y1={labelY - 9}
                  y2={pad.top + plotHeight}
                />
                <text className="chart-label-text" x={x(at) + 3} y={labelY}>
                  {row === undefined ? glyph : text}
                </text>
              </g>
            );
          })}
          {hoverAt !== undefined && (
            <line
              className="chart-hover"
              x1={x(hoverAt)}
              x2={x(hoverAt)}
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
      {hoverAt !== undefined && (
        <p className="day-chart-details" aria-live="polite">
          <b>{amsterdamClockTime.format(hoverAt)}</b>{" "}
          {[
            ...hoveredLabels.map(({ text }) => text),
            ...describeBucket(hovered, emptyDetails),
          ].join(" · ")}
        </p>
      )}
    </article>
  );
}
