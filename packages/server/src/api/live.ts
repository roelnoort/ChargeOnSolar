import {
  type ChargerState,
  type LiveSnapshot,
  livePath,
  liveStreamPath,
  snapshotEvent,
  type ZaptecMode,
} from "@charge-on-solar/shared";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Cancel, Clock } from "../clock.ts";
import type { ChargerReading } from "../domain/charger-reading.ts";
import { fuseHeadroomA, surplusW } from "../domain/energy.ts";
import type { LiveState } from "../domain/live-state.ts";
import type { SessionEnv } from "./session.ts";

export interface LiveRouteDependencies {
  live: LiveState;
  clock: Clock;
  mainFuseA: number;
}

// Zaptec's ChargerOperationMode (state 710).
function toChargerState({
  operationMode,
  finalStopActive,
}: ChargerReading): ChargerState {
  switch (operationMode) {
    case 1:
      return "disconnected";
    case 2:
      return "connected";
    case 3:
      return "charging";
    case 5:
      return finalStopActive ? "paused" : "finished";
    default:
      return "unknown";
  }
}

// Zaptec's availableCurrentMode.
const zaptecModes: Record<number, ZaptecMode> = {
  0: "default",
  1: "scheduled",
  2: "apm",
};

function toZaptecMode({ availableCurrentMode }: ChargerReading): ZaptecMode {
  return availableCurrentMode === null
    ? "unknown"
    : (zaptecModes[availableCurrentMode] ?? "unknown");
}

export function toLiveSnapshot(
  live: LiveState,
  now: Date,
  mainFuseA: number
): LiveSnapshot {
  const p1 = live.p1();
  const charger = live.charger();
  return {
    at: now.toISOString(),
    p1: p1
      ? {
          lastSeenAt: p1.receivedAt.toISOString(),
          reading: {
            netPowerW: p1.netPowerW,
            phases: p1.phases,
            deviceTimestamp: p1.deviceTimestamp,
          },
        }
      : null,
    charger: charger
      ? {
          lastSeenAt: charger.receivedAt.toISOString(),
          reading: {
            chargerPowerW: charger.chargerPowerW,
            chargingCurrentSetA: charger.chargingCurrentSetA,
            state: toChargerState(charger),
            nextScheduleEvent: charger.nextScheduleEvent,
            phaseSetting: charger.phaseSetting,
            maxCurrentA: charger.maxCurrentA,
            phaseCurrentsA: charger.phaseCurrentsA,
            zaptecMode: toZaptecMode(charger),
            apmActive: toZaptecMode(charger) === "apm",
            surplusModeActive: charger.surplusModeActive,
          },
        }
      : null,
    surplusW: surplusW(p1, charger),
    mainFuseA,
    fuseHeadroomA: fuseHeadroomA(p1, charger, mainFuseA),
  };
}

export function addLiveRoutes(
  app: Hono<SessionEnv>,
  { live, clock, mainFuseA }: LiveRouteDependencies
) {
  app.get(livePath, (c) =>
    c.json(toLiveSnapshot(live, clock.now(), mainFuseA))
  );

  app.get(liveStreamPath, (c) =>
    streamSSE(c, async (stream) => {
      let lastSentAt = Number.NEGATIVE_INFINITY;
      let lastSentState: string | undefined;
      let pending: Cancel | undefined;

      function sendIfChanged() {
        pending = undefined;
        const snapshot = toLiveSnapshot(live, clock.now(), mainFuseA);
        const state = JSON.stringify({ ...snapshot, at: undefined });
        if (state === lastSentState) return;
        lastSentState = state;
        lastSentAt = clock.now().getTime();
        void stream.writeSSE({
          event: snapshotEvent,
          data: JSON.stringify(snapshot),
        });
      }

      function onChange() {
        if (pending) return;
        const wait = lastSentAt + minimumEventGapMs - clock.now().getTime();
        if (wait <= 0) sendIfChanged();
        else pending = clock.after(wait, sendIfChanged);
      }

      sendIfChanged();
      const stopListening = live.onChange(onChange);
      await new Promise<void>((resolve) => stream.onAbort(resolve));
      stopListening();
      pending?.();
    })
  );
}

const minimumEventGapMs = 1000;
