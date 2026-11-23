import {
  type CallBudget,
  chargerStaleAfterMs,
  type LiveSnapshot,
} from "@charge-on-solar/shared";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../api/client.ts";
import type { Clock } from "../clock.ts";
import { messageOf } from "../message-of.ts";
import {
  dataAgeMs,
  describeApmWarning,
  describeAsOf,
  describeCallBudget,
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
import { describeShadowDecision } from "./describe-shadow.ts";
import {
  connectLiveStream,
  type LiveStreamState,
  type StreamStatus,
} from "./live-stream.ts";
import { OverrideControl } from "./OverrideControl.tsx";

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
  const warning = describeApmWarning(charger.reading.zaptecMode);
  if (!warning) return null;
  return (
    <p className="banner banner-warning" role="alert">
      {warning}
    </p>
  );
}

type RefreshState =
  | { kind: "idle" }
  | { kind: "refreshing" }
  | { kind: "failed"; message: string };

/** Refreshes Solar production on request, and follows the Enphase call budget. */
function useSolarRefresh(api: ApiClient) {
  const [state, setState] = useState<RefreshState>({ kind: "idle" });
  const [budget, setBudget] = useState<CallBudget>();
  useEffect(() => {
    let current = true;
    api.solarBudget().then(
      (loaded) => current && setBudget(loaded),
      () => {}
    );
    return () => {
      current = false;
    };
  }, [api]);
  const refresh = useCallback(() => {
    setState({ kind: "refreshing" });
    api.refreshSolar().then(
      (answer) => {
        setBudget(answer.budget);
        setState({ kind: "idle" });
      },
      (error: unknown) =>
        setState({ kind: "failed", message: messageOf(error) })
    );
  }, [api]);
  return { state, budget, refresh };
}

function FlowCircle({
  label,
  power,
  kind,
  children,
}: {
  label: string;
  power: string | undefined;
  kind: string;
  children?: ReactNode;
}) {
  return (
    <figure className={`flow flow-${kind}`}>
      <div className="flow-circle">{power ?? "–"}</div>
      <figcaption>{label}</figcaption>
      {children}
    </figure>
  );
}

function PowerFlows({
  snapshot,
  api,
}: {
  snapshot: LiveSnapshot | undefined;
  api: ApiClient;
}) {
  const netPowerW = snapshot?.p1?.reading.netPowerW;
  const grid = netPowerW === undefined ? undefined : describeGrid(netPowerW);
  const surplusW = snapshot?.surplusW;
  const solar = snapshot?.solar;
  const houseConsumptionW = snapshot?.houseConsumptionW;
  const { state, budget, refresh } = useSolarRefresh(api);
  const refreshing = state.kind === "refreshing";
  return (
    <section className="flows" aria-label="Power flows">
      <FlowCircle
        label="Solar"
        power={solar ? formatPower(solar.solarProductionW) : undefined}
        kind="solar"
      >
        {solar && <p className="flow-note">{describeAsOf(solar.asOf)}</p>}
        <button
          type="button"
          className="flow-refresh"
          onClick={refresh}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </FlowCircle>
      <FlowCircle
        label="House"
        power={
          houseConsumptionW == null ? undefined : formatPower(houseConsumptionW)
        }
        kind="house"
      />
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
        kind={grid?.direction === "importing" ? "import" : "export"}
      />
      {state.kind === "failed" ? (
        <p className="flows-note flows-note-refused" role="alert">
          {state.message}
        </p>
      ) : (
        budget && <p className="flows-note">{describeCallBudget(budget)}</p>
      )}
    </section>
  );
}

function ShadowDecisionCard({
  snapshot,
}: {
  snapshot: LiveSnapshot | undefined;
}) {
  const record = snapshot?.shadowDecision ?? null;
  const described = record && describeShadowDecision(record);
  const charger = snapshot?.charger?.reading;
  return (
    <article
      className="card shadow-decision"
      aria-labelledby="shadow-decision-heading"
    >
      <h3 id="shadow-decision-heading">Shadow decision</h3>
      {described ? (
        <>
          <p className="shadow-sentence">{described.sentence}</p>
          {described.withoutPause && (
            <p className="shadow-underlying">
              Without the pause: {described.withoutPause}
            </p>
          )}
        </>
      ) : (
        <p className="placeholder">No Shadow decision yet.</p>
      )}
      {charger && (
        <p className="shadow-charger">
          The charger itself: {describeChargerState(charger.state)}
          {charger.chargingCurrentSetA !== null &&
            `, ${formatCurrent(charger.chargingCurrentSetA)} set by Zaptec`}
        </p>
      )}
      <p className="data-age">
        Never sent to the charger
        {record &&
          ` · decided at ${new Date(record.at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}`}
      </p>
    </article>
  );
}

export function NowView({ clock, api }: { clock: Clock; api: ApiClient }) {
  const { status, latest, override } = useLiveStream(clock);
  const now = useNow(clock);
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

      <ShadowDecisionCard snapshot={snapshot} />

      <PowerFlows snapshot={snapshot} api={api} />

      {snapshot && (
        <OverrideControl
          api={api}
          snapshot={snapshot}
          streamOverride={override}
          chargerStale={chargerAge?.stale ?? true}
        />
      )}

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
