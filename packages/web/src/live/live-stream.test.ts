import {
  decisionEvent,
  type LiveSnapshot,
  liveStreamPath,
  type ManualOverride,
  overrideEvent,
  type ShadowDecisionRecord,
  type SolarUpdated,
  snapshotEvent,
  solarUpdatedEvent,
} from "@charge-on-solar/shared";
import { describe, expect, it } from "vitest";
import {
  connectLiveStream,
  type EventSourceLike,
  type LiveStreamState,
} from "./live-stream.ts";

const snapshot: LiveSnapshot = {
  at: "2026-06-01T12:00:10.000Z",
  p1: {
    lastSeenAt: "2026-06-01T12:00:09.000Z",
    reading: {
      netPowerW: -850,
      phases: {
        l1: { powerW: -850, currentA: 3.7, voltageV: 230 },
        l2: { powerW: null, currentA: null, voltageV: null },
        l3: { powerW: null, currentA: null, voltageV: null },
      },
      deviceTimestamp: null,
    },
  },
  charger: null,
  surplusW: null,
  mainFuseA: 25,
  fuseHeadroomA: null,
  solar: null,
  houseConsumptionW: null,
  override: { command: "pause", unavailableReason: "charger-offline" },
  switchBudget: null,
  shadowDecision: null,
};

const pauseAccepted: ManualOverride = {
  id: 7,
  command: "pause",
  status: "accepted",
  sentAt: "2026-06-01T12:00:05.000Z",
  user: { id: 1, name: "Sam" },
  rejection: null,
};

const decisionStart: ShadowDecisionRecord = {
  at: "2026-06-01T12:01:00.000Z",
  decision: { kind: "start", currentAmps: 14, limitedBy: "surplus" },
  chargingCurrentA: 14,
  phaseSetting: 1,
  inputs: {
    surplusW: 3300,
    netPowerW: -3300,
    solarProductionW: null,
    chargerPowerW: 0,
    fuseHeadroomA: 12,
    startWindowSurplusW: 3300,
    stopWindowSurplusW: 3300,
    dataAgeMs: { p1: 1000, charger: 20_000, solar: null },
  },
  zaptec: {
    availableCurrentMode: 2,
    enabledFeatures: null,
    surplusModeActive: false,
    chargeCurrentSetA: 16,
  },
  rulesVersion: 1,
  settings: {
    solarMode: "solar-only",
    startWindowMinutes: 5,
    stopWindowMinutes: 10,
    minimumOnTimeMinutes: 15,
    minimumOffTimeMinutes: 15,
    currentHoldMinutes: 15,
    deadBandAmps: 1,
    voltage: 230,
    mainFuseAmps: 25,
    minimumSolarWatts: 0,
    tickIntervalSeconds: 60,
  },
};

class FakeEventSource implements EventSourceLike {
  readyState = 0;
  closed = false;
  readonly url: string;
  private listeners = new Map<string, (event: { data?: unknown }) => void>();
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(
    type: string,
    listener: (event: { data?: unknown }) => void
  ) {
    this.listeners.set(type, listener);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.listeners.get("open")?.({});
  }
  emit(type: string, data: string) {
    this.listeners.get(type)?.({ data });
  }
  fail(readyState: 0 | 2) {
    this.readyState = readyState;
    this.listeners.get("error")?.({});
  }
}

function harness() {
  const sources: FakeEventSource[] = [];
  const timers: { ms: number; run: () => void }[] = [];
  const states: LiveStreamState[] = [];
  const solarUpdates: SolarUpdated[] = [];
  const decisions: ShadowDecisionRecord[] = [];
  const overrides: ManualOverride[] = [];
  let time = 1_000_000;
  const stream = connectLiveStream({
    createEventSource: (url) => {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source;
    },
    after: (ms, run) => {
      const timer = { ms, run };
      timers.push(timer);
      return () => timers.splice(timers.indexOf(timer), 1);
    },
    now: () => time,
    onChange: (state) => states.push(state),
    onSolarUpdated: (update) => solarUpdates.push(update),
    onDecision: (decision) => decisions.push(decision),
    onOverride: (override) => overrides.push(override),
  });
  return {
    stream,
    solarUpdates,
    decisions,
    overrides,
    sources,
    timers,
    latest: () => states.at(-1),
    setTime: (t: number) => {
      time = t;
    },
  };
}

describe("the live stream", () => {
  it("opens the server's live stream and is connecting until it opens", () => {
    const { sources, latest } = harness();

    expect(sources.map((source) => source.url)).toEqual([liveStreamPath]);
    expect(latest()).toEqual({ status: "connecting" });

    sources[0]?.open();
    expect(latest()).toEqual({ status: "connected" });
  });

  it("keeps each snapshot with when it arrived", () => {
    const { sources, latest } = harness();
    sources[0]?.open();

    sources[0]?.emit(snapshotEvent, JSON.stringify(snapshot));

    expect(latest()).toEqual({
      status: "connected",
      latest: { snapshot, receivedAt: 1_000_000 },
    });
  });

  it("ignores a snapshot that breaks the contract", () => {
    const { sources, latest } = harness();
    sources[0]?.open();

    sources[0]?.emit(snapshotEvent, JSON.stringify({ at: "yesterday" }));

    expect(latest()).toEqual({ status: "connected" });
  });

  it("keeps the latest Manual override from each override event", () => {
    const { sources, latest } = harness();
    sources[0]?.open();

    sources[0]?.emit(overrideEvent, JSON.stringify(pauseAccepted));
    sources[0]?.emit(
      overrideEvent,
      JSON.stringify({ ...pauseAccepted, status: "confirmed" })
    );

    expect(latest()).toEqual({
      status: "connected",
      override: { ...pauseAccepted, status: "confirmed" },
    });
  });

  it("ignores an override event that breaks the contract", () => {
    const { sources, latest } = harness();
    sources[0]?.open();

    sources[0]?.emit(overrideEvent, JSON.stringify({ status: "done" }));

    expect(latest()).toEqual({ status: "connected" });
  });

  it("shows it is reconnecting while the browser retries a dropped stream", () => {
    const { sources, latest } = harness();
    sources[0]?.open();
    sources[0]?.emit(snapshotEvent, JSON.stringify(snapshot));

    sources[0]?.fail(0);

    expect(latest()?.status).toBe("reconnecting");
    expect(latest()?.latest?.snapshot).toEqual(snapshot);
    sources[0]?.open();
    expect(latest()?.status).toBe("connected");
  });

  it("opens a new stream after a while when the browser gives up on it", () => {
    const { sources, timers, latest } = harness();
    sources[0]?.open();

    sources[0]?.fail(2);

    expect(latest()?.status).toBe("reconnecting");
    expect(sources).toHaveLength(1);
    expect(timers.map((timer) => timer.ms)).toEqual([3000]);
    timers[0]?.run();
    expect(sources).toHaveLength(2);
    sources[1]?.open();
    expect(latest()?.status).toBe("connected");
  });

  it("closes the stream and stops reconnecting when closed", () => {
    const { stream, sources, timers } = harness();
    sources[0]?.fail(2);

    stream.close();

    expect(sources[0]?.closed).toBe(true);
    expect(timers).toEqual([]);
  });

  it("passes on each fetch from Enphase the server announces", () => {
    const { sources, solarUpdates } = harness();
    sources[0]?.open();
    const update: SolarUpdated = {
      fetchedAt: "2026-06-01T12:00:00.000Z",
      solar: { asOf: "2026-06-01T11:55:00.000Z", solarProductionW: 3100 },
    };

    sources[0]?.emit(solarUpdatedEvent, JSON.stringify(update));
    sources[0]?.emit(solarUpdatedEvent, JSON.stringify({ solar: "lots" }));

    expect(solarUpdates).toEqual([update]);
  });

  it("passes on each Shadow decision the server sends", () => {
    const { sources, decisions } = harness();
    sources[0]?.open();

    sources[0]?.emit(decisionEvent, JSON.stringify(decisionStart));
    sources[0]?.emit(decisionEvent, JSON.stringify({ at: "noon" }));

    expect(decisions).toEqual([decisionStart]);
  });

  it("passes on each step of a Manual override", () => {
    const { sources, overrides } = harness();
    sources[0]?.open();

    sources[0]?.emit(overrideEvent, JSON.stringify(pauseAccepted));
    sources[0]?.emit(overrideEvent, JSON.stringify({ status: "done" }));

    expect(overrides).toEqual([pauseAccepted]);
  });
});
