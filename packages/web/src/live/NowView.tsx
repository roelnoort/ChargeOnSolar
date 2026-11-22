import { useEffect, useState } from "react";
import { describeDataAge, describeNetPower, p1DataAgeMs } from "./describe.ts";
import {
  connectLiveStream,
  type LiveStreamState,
  type StreamStatus,
} from "./live-stream.ts";

function useLiveStream(): LiveStreamState {
  const [state, setState] = useState<LiveStreamState>({
    status: "connecting",
  });
  useEffect(() => {
    const stream = connectLiveStream({
      createEventSource: (url) => new EventSource(url),
      after: (milliseconds, callback) => {
        const timer = setTimeout(callback, milliseconds);
        return () => clearTimeout(timer);
      },
      now: Date.now,
      onChange: setState,
    });
    return () => stream.close();
  }, []);
  return state;
}

/** The current time, updated every second. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const statusLabels: Record<StreamStatus, string> = {
  connecting: "Connecting…",
  connected: "Live",
  reconnecting: "Reconnecting…",
};

export function NowView() {
  const { status, latest } = useLiveStream();
  const now = useNow();
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
