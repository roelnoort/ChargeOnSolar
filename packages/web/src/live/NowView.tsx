import { useEffect, useState } from "react";
import type { Clock } from "../clock.ts";
import { describeDataAge, describeNetPower, p1DataAgeMs } from "./describe.ts";
import {
  connectLiveStream,
  type LiveStreamState,
  type StreamStatus,
} from "./live-stream.ts";

function useLiveStream(clock: Clock): LiveStreamState {
  const [state, setState] = useState<LiveStreamState>({
    status: "connecting",
  });
  useEffect(() => {
    const stream = connectLiveStream({
      createEventSource: (url) => new EventSource(url),
      after: clock.after,
      now: clock.now,
      onChange: setState,
    });
    return () => stream.close();
  }, [clock]);
  return state;
}

/** The current time, updated every second. */
function useNow(clock: Clock): number {
  const [now, setNow] = useState(clock.now);
  useEffect(() => {
    let cancel = () => {};
    const tick = () => {
      setNow(clock.now());
      cancel = clock.after(1000, tick);
    };
    cancel = clock.after(1000, tick);
    return () => cancel();
  }, [clock]);
  return now;
}

const statusLabels: Record<StreamStatus, string> = {
  connecting: "Connecting…",
  connected: "Live",
  reconnecting: "Reconnecting…",
};

export function NowView({ clock }: { clock: Clock }) {
  const { status, latest } = useLiveStream(clock);
  const now = useNow(clock);
  const p1 = latest?.snapshot.p1;
  const netPower = p1 && describeNetPower(p1.reading.netPowerW);
  const age =
    latest && p1
      ? describeDataAge(
          p1DataAgeMs({
            serverAt: latest.snapshot.at,
            lastSeenAt: p1.lastSeenAt,
            receivedAt: latest.receivedAt,
            now,
          })
        )
      : undefined;

  return (
    <>
      <p className={`stream stream-${status}`} role="status">
        <span className="stream-dot" aria-hidden="true" />
        {statusLabels[status]}
      </p>

      <article className="card" aria-labelledby="net-power-heading">
        <h3 id="net-power-heading">Net power</h3>
        {netPower ? (
          <p className={`net-power net-power-${netPower.direction}`}>
            <span className="net-power-label">{netPower.label}</span>{" "}
            <span className="net-power-value">{netPower.power}</span>
          </p>
        ) : (
          <p className="placeholder">No Reading from the P1 meter yet.</p>
        )}
        {age && (
          <p className={age.stale ? "data-age data-age-stale" : "data-age"}>
            P1 data {age.text}
          </p>
        )}
      </article>
    </>
  );
}
