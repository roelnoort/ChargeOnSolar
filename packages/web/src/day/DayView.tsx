import type { DayTimeline, LocalDay } from "@charge-on-solar/shared";
import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../api/client.ts";
import type { Clock } from "../clock.ts";
import { connectLiveStream } from "../live/live-stream.ts";
import { messageOf } from "../message-of.ts";
import { amsterdamToday, describeDay, shiftDay } from "./local-day.ts";
import { RealChart, realChartAreas } from "./RealChart.tsx";

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

/** Calls `onSolarUpdated` after each fetch from Enphase, while `following`. */
function useSolarUpdates(
  clock: Clock,
  following: boolean,
  onSolarUpdated: () => void
) {
  useEffect(() => {
    if (!following) return;
    const stream = connectLiveStream({
      createEventSource: (url) => new EventSource(url),
      after: clock.after,
      now: clock.now,
      onChange: () => {},
      onSolarUpdated,
    });
    return () => stream.close();
  }, [clock, following, onSolarUpdated]);
}

export function DayView({ clock, api }: { clock: Clock; api: ApiClient }) {
  const today = amsterdamToday(clock.now());
  const [day, setDay] = useState<LocalDay>(today);
  const { state, reload } = useDayTimeline(api, clock, day);
  const isToday = day === today;
  useSolarUpdates(clock, isToday, reload);
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
      {shown && <RealChart timeline={shown.timeline} now={shown.loadedAt} />}
    </div>
  );
}
