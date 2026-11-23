import {
  type DayOverride,
  type DayTimeline,
  type LocalDay,
  type ManualOverride,
  type ShadowDecisionRecord,
  toDayOverride,
} from "@charge-on-solar/shared";
import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../api/client.ts";
import type { Clock } from "../clock.ts";
import { connectLiveStream } from "../live/live-stream.ts";
import { messageOf } from "../message-of.ts";
import { chartScaleW, DayChart, realChartAreas } from "./DayChart.tsx";
import {
  dayOverrides,
  dayPoints,
  dayShadowSwitches,
  withDecision,
} from "./day-points.ts";
import {
  amsterdamToday,
  describeDay,
  nextAmsterdamDayAt,
  shiftDay,
} from "./local-day.ts";
import {
  realChartBucket,
  shadowChartBucket,
  solarNotFetchedFrom,
} from "./real-chart.ts";

type TimelineState =
  | { kind: "loading" }
  | { kind: "loaded"; timeline: DayTimeline; loadedAt: number }
  | { kind: "failed"; message: string };

function useDayTimeline(api: ApiClient, clock: Clock, day: LocalDay) {
  const [state, setState] = useState<TimelineState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reloads` asks for the same day again.
  useEffect(() => {
    let current = true;
    api.dayTimeline(day).then(
      (timeline) =>
        current &&
        setState({ kind: "loaded", timeline, loadedAt: clock.now() }),
      (error: unknown) =>
        current && setState({ kind: "failed", message: messageOf(error) })
    );
    return () => {
      current = false;
    };
  }, [api, clock, day, reloads]);
  const reload = useCallback(() => setReloads((count) => count + 1), []);
  return { state, reload };
}

interface LiveDay {
  decisions: ShadowDecisionRecord[];
  overrides: DayOverride[];
}

const noLiveDay: LiveDay = { decisions: [], overrides: [] };

/**
 * While `following`, collects the Shadow decisions and Manual override steps
 * the live stream sends, and calls `onSolarUpdated` after each fetch from
 * Enphase.
 */
function useLiveDay(
  clock: Clock,
  following: boolean,
  onSolarUpdated: () => void
): LiveDay {
  const [live, setLive] = useState<LiveDay>(noLiveDay);
  useEffect(() => {
    setLive(noLiveDay);
    if (!following) return;
    const addDecision = (decision: ShadowDecisionRecord) =>
      setLive((current) => {
        const decisions = withDecision(current.decisions, decision);
        return decisions === current.decisions
          ? current
          : { ...current, decisions };
      });
    const stream = connectLiveStream({
      createEventSource: (url) => new EventSource(url),
      after: clock.after,
      now: clock.now,
      onChange: ({ latest }) => {
        const decision = latest?.snapshot.shadowDecision;
        if (decision) addDecision(decision);
      },
      onSolarUpdated,
      onDecision: addDecision,
      onOverride: (override: ManualOverride) =>
        setLive((current) => ({
          ...current,
          overrides: [...current.overrides, toDayOverride(override)],
        })),
    });
    return () => stream.close();
  }, [clock, following, onSolarUpdated]);
  return live;
}

/** Today's Europe/Amsterdam day, moving on at midnight. */
function useAmsterdamToday(clock: Clock): LocalDay {
  const [today, setToday] = useState(() => amsterdamToday(clock.now()));
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new `today` waits for the next midnight.
  useEffect(() => {
    const now = clock.now();
    return clock.after(nextAmsterdamDayAt(now) - now, () =>
      setToday(amsterdamToday(clock.now()))
    );
  }, [clock, today]);
  return today;
}

export function DayView({ clock, api }: { clock: Clock; api: ApiClient }) {
  const today = useAmsterdamToday(clock);
  const [day, setDay] = useState<LocalDay>(today);
  const { state, reload } = useDayTimeline(api, clock, day);
  const isToday = day === today;
  const live = useLiveDay(clock, isToday, reload);
  const [hoverAt, setHoverAt] = useState<number | undefined>();
  const shown =
    state.kind === "loaded" && state.timeline.day === day ? state : undefined;

  return (
    <div className="day-view">
      <nav className="day-nav" aria-label="Days">
        <button
          type="button"
          className="day-step"
          aria-label="Previous day"
          onClick={() => setDay(shiftDay(day, -1))}
        >
          ‹
        </button>
        <p className="day-title">
          <b>{describeDay(day, today)}</b>{" "}
          <time className="day-date" dateTime={day}>
            {day}
          </time>
        </p>
        <button
          type="button"
          className="day-step"
          aria-label="Next day"
          disabled={isToday}
          onClick={() => setDay(shiftDay(day, 1))}
        >
          ›
        </button>
        <button
          type="button"
          className="day-today"
          disabled={isToday}
          onClick={() => setDay(today)}
        >
          Today
        </button>
      </nav>

      <ul className="chart-legend" aria-label="Legend">
        {realChartAreas.map(({ key, label, kind }) => (
          <li key={key}>
            <i className={`legend-swatch area-${kind}`} aria-hidden="true" />
            {label}
          </li>
        ))}
      </ul>

      {state.kind !== "failed" && !shown && (
        <p className="placeholder">Loading the day…</p>
      )}
      {state.kind === "failed" && (
        <p className="status status-down" role="alert">
          The day could not be loaded: {state.message}
        </p>
      )}
      {shown && (
        <DayCharts
          timeline={shown.timeline}
          loadedAt={shown.loadedAt}
          live={isToday ? live : noLiveDay}
          hoverAt={hoverAt}
          onHover={setHoverAt}
        />
      )}
    </div>
  );
}

/** The Real chart with the Shadow chart under it, on one time axis and kW scale. */
function DayCharts({
  timeline,
  loadedAt,
  live,
  hoverAt,
  onHover,
}: {
  timeline: DayTimeline;
  loadedAt: number;
  live: LiveDay;
  hoverAt: number | undefined;
  onHover: (at: number | undefined) => void;
}) {
  const points = dayPoints(timeline, loadedAt, live.decisions);
  const realBuckets = points.map(realChartBucket);
  const shadowBuckets = points.map(shadowChartBucket);
  const lastPointEnd = points.at(-1)?.end;
  const shared = {
    timeline,
    scaleW: chartScaleW(realBuckets, shadowBuckets),
    now: Math.max(loadedAt, lastPointEnd ? Date.parse(lastPointEnd) : 0),
    solarNotFetchedFrom: solarNotFetchedFromOf(timeline),
    overrides: dayOverrides(timeline, live.overrides),
    hoverAt,
    onHover,
  };
  return (
    <>
      <DayChart
        {...shared}
        name="real"
        title="Real"
        subtitle="what happened"
        buckets={realBuckets}
        switches={[]}
        emptyDetails="No Readings"
      />
      <DayChart
        {...shared}
        name="shadow"
        title="Shadow"
        subtitle="had the Shadow decisions been sent"
        buckets={shadowBuckets}
        switches={dayShadowSwitches(timeline, loadedAt, live.decisions)}
        emptyDetails="No Shadow decision"
      />
    </>
  );
}

function solarNotFetchedFromOf(timeline: DayTimeline): number | undefined {
  const from = solarNotFetchedFrom(timeline.buckets);
  return from === undefined ? undefined : Date.parse(from);
}
