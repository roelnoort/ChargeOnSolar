import {
  type LiveSnapshot,
  livePath,
  liveSnapshot,
  liveStreamPath,
  snapshotEvent,
} from "@charge-on-solar/shared";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Cancel, Clock } from "../clock.ts";
import type { LiveState } from "../domain/live-state.ts";

export interface LiveRouteDependencies {
  live: LiveState;
  clock: Clock;
}

export function toLiveSnapshot(live: LiveState, now: Date): LiveSnapshot {
  const p1 = live.p1();
  return liveSnapshot.parse({
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
  });
}

export function addLiveRoutes(
  app: Hono,
  { live, clock }: LiveRouteDependencies
) {
  app.get(livePath, (c) => c.json(toLiveSnapshot(live, clock.now())));

  app.get(liveStreamPath, (c) =>
    streamSSE(c, async (stream) => {
      let lastSentAt = Number.NEGATIVE_INFINITY;
      let lastSentState: string | undefined;
      let pending: Cancel | undefined;

      function sendIfChanged() {
        pending = undefined;
        const snapshot = toLiveSnapshot(live, clock.now());
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
