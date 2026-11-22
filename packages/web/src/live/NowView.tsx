import type { LiveSnapshot } from "@charge-on-solar/shared";
import { useEffect, useState } from "react";
import {
  chargerStaleAfterMs,
  dataAgeMs,
  describeChargerState,
  describeDataAge,
  describeGrid,
  describeNetPower,
  describePhaseSetting,
  describeZaptecMode,
  formatCurrent,
  formatPower,
  formatSignedPower,
} from "./describe.ts";
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

type Latest = NonNullable<LiveStreamState["latest"]>;

function ageOf(
  latest: Latest,
  device: { lastSeenAt: string } | null,
  now: number,
  staleAfterMs?: number
) {
  if (!device) return undefined;
  return describeDataAge(
    dataAgeMs({
      serverAt: latest.snapshot.at,
      lastSeenAt: device.lastSeenAt,
      receivedAt: latest.receivedAt,
      now,
    }),
    staleAfterMs
  );
}

function ApmOffBanner({ charger }: { charger: LiveSnapshot["charger"] }) {
  if (!charger || charger.reading.apmActive) return null;
  return (
    <p className="banner banner-warning" role="alert">
      Zaptec's load balancing (APM) is not active: Zaptec is in{" "}
      {describeZaptecMode(charger.reading.zaptecMode)} mode, so it does not
      guard the main fuse.
    </p>
  );
}

function FlowCircle({
  label,
  power,
  kind,
}: {
  label: string;
  power: string | undefined;
  kind: string;
}) {
  return (
    <figure className={`flow flow-${kind}`}>
      <div className="flow-circle">{power ?? "–"}</div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

function PowerFlows({ snapshot }: { snapshot: LiveSnapshot | undefined }) {
  const netPowerW = snapshot?.p1?.reading.netPowerW;
  const grid = netPowerW === undefined ? undefined : describeGrid(netPowerW);
  const surplusW = snapshot?.surplusW;
  return (
    <section className="flows" aria-label="Power flows">
      <FlowCircle
        label="Surplus"
        power={surplusW == null ? undefined : formatSignedPower(surplusW)}
        kind={surplusW != null && surplusW < 0 ? "short" : "surplus"}
      />
      <FlowCircle
        label="Car"
        power={
          snapshot?.charger?.reading.chargerPowerW == null
            ? undefined
            : formatPower(snapshot.charger.reading.chargerPowerW)
        }
        kind="car"
      />
      <FlowCircle
        label={grid?.label ?? "Grid"}
        power={grid?.power}
        kind={netPowerW !== undefined && netPowerW > 0 ? "import" : "export"}
      />
    </section>
  );
}

export function NowView() {
  const { status, latest } = useLiveStream();
  const now = useNow();
  const snapshot = latest?.snapshot;
  const p1 = snapshot?.p1 ?? null;
  const charger = snapshot?.charger ?? null;
  const netPower = p1 && describeNetPower(p1.reading.netPowerW);
  const p1Age = latest && ageOf(latest, p1, now);
  const chargerAge = latest && ageOf(latest, charger, now, chargerStaleAfterMs);

  return (
    <>
      <ApmOffBanner charger={charger} />

      <p className={`stream stream-${status}`} role="status">
        <span className="stream-dot" aria-hidden="true" />
        {statusLabels[status]}
      </p>

      <PowerFlows snapshot={snapshot} />

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
        {p1Age && (
          <p className={p1Age.stale ? "data-age data-age-stale" : "data-age"}>
            P1 data {p1Age.text}
          </p>
        )}
      </article>

      <article className="card" aria-labelledby="charger-heading">
        <h3 id="charger-heading">Charger</h3>
        {charger ? (
          <dl className="figures">
            <dt>Charger power</dt>
            <dd>
              {charger.reading.chargerPowerW === null
                ? "Unknown"
                : formatPower(charger.reading.chargerPowerW)}
            </dd>
            <dt>Surplus</dt>
            <dd>
              {snapshot?.surplusW == null
                ? "Unknown"
                : formatSignedPower(snapshot.surplusW)}
            </dd>
            <dt>Fuse headroom</dt>
            <dd>
              {snapshot?.fuseHeadroomA == null
                ? "Unknown"
                : formatCurrent(snapshot.fuseHeadroomA)}
            </dd>
            <dt>Main fuse</dt>
            <dd>{snapshot && formatCurrent(snapshot.mainFuseA)}</dd>
            <dt>State</dt>
            <dd>{describeChargerState(charger.reading.state)}</dd>
            <dt>Phase setting</dt>
            <dd>{describePhaseSetting(charger.reading.phaseSetting)}</dd>
            <dt>Maximum current</dt>
            <dd>
              {charger.reading.maxCurrentA === null
                ? "Unknown"
                : formatCurrent(charger.reading.maxCurrentA)}
            </dd>
            <dt>Zaptec mode</dt>
            <dd>{describeZaptecMode(charger.reading.zaptecMode)}</dd>
          </dl>
        ) : (
          <p className="placeholder">No Reading from Zaptec yet.</p>
        )}
        {chargerAge && (
          <p
            className={
              chargerAge.stale ? "data-age data-age-stale" : "data-age"
            }
          >
            Zaptec data {chargerAge.text}
          </p>
        )}
      </article>
    </>
  );
}
