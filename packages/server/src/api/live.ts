import {
  decisionEvent,
  type LiveSnapshot,
  livePath,
  liveStreamPath,
  overrideEvent,
  snapshotEvent,
  type ZaptecMode,
} from "@charge-on-solar/shared";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Cancel, Clock } from "../clock.ts";
import {
  type ChargerReading,
  toChargerState,
} from "../domain/charger-reading.ts";
import { fuseHeadroomA, surplusW } from "../domain/energy.ts";
import type { LiveState } from "../domain/live-state.ts";
import { switchesPerChargeSession } from "../domain/switch-budget.ts";
import type { Overrides } from "../overrides.ts";
import type { SettingsStore } from "../settings.ts";
import { toManualOverride } from "./overrides.ts";
import type { SessionEnv } from "./session.ts";
import { toShadowDecisionRecord } from "./shadow.ts";

export interface LiveRouteDependencies {
  live: LiveState;
  overrides: Overrides;
  clock: Clock;
  settings: SettingsStore;
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

export function toLiveSnapshot({
  live,
  overrides,
  clock,
  settings,
}: LiveRouteDependencies): LiveSnapshot {
  const now = clock.now();
  const mainFuseA = settings.current().mainFuseAmps;
  const p1 = live.p1();
  const charger = live.charger();
  const interruptions = live.interruptions();
  const shadowDecision = live.shadowDecision();
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
    override: overrides.availability(),
    switchBudget:
      interruptions === null
        ? null
        : {
            switchesLeft: Math.max(0, switchesPerChargeSession - interruptions),
            switchesPerSession: switchesPerChargeSession,
          },
    shadowDecision: shadowDecision
      ? toShadowDecisionRecord(shadowDecision)
      : null,
  };
}

export function addLiveRoutes(
  app: Hono<SessionEnv>,
  dependencies: LiveRouteDependencies
) {
  const { live, overrides, clock } = dependencies;
  app.get(livePath, (c) => c.json(toLiveSnapshot(dependencies)));

  app.get(liveStreamPath, (c) =>
    streamSSE(c, async (stream) => {
      let lastSentAt = Number.NEGATIVE_INFINITY;
      let lastSentState: string | undefined;
      let pending: Cancel | undefined;

      function sendIfChanged() {
        pending = undefined;
        const snapshot = toLiveSnapshot(dependencies);
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
      const stopDecisions = live.onShadowDecision((decision) => {
        void stream.writeSSE({
          event: decisionEvent,
          data: JSON.stringify(toShadowDecisionRecord(decision)),
        });
      });
      const stopFollowingOverrides = overrides.onChange((progress) => {
        void stream.writeSSE({
          event: overrideEvent,
          data: JSON.stringify(toManualOverride(progress)),
        });
        onChange();
      });
      await new Promise<void>((resolve) => stream.onAbort(resolve));
      stopListening();
      stopDecisions();
      stopFollowingOverrides();
      pending?.();
    })
  );
}

const minimumEventGapMs = 1000;
