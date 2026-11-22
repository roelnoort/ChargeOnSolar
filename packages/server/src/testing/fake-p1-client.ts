import type { P1Phase } from "@charge-on-solar/shared";
import type { Clock } from "../clock.ts";
import type { P1Reading } from "../domain/p1-reading.ts";
import type { P1Client } from "../p1/client.ts";

export interface FakeReading {
  netPowerW: number;
  phases?: Partial<P1Reading["phases"]>;
  deviceTimestamp?: string | null;
}

/** Stands in for the P1 meter: tests decide what it sends, and when it fails. */
export interface FakeP1Client extends P1Client {
  /** Sends a Reading over the open stream, received now by the fake clock. */
  send(reading: FakeReading): void;
  /** Ends the open stream, as a network drop would. */
  drop(reason?: string): void;
  /** While true, every connect attempt fails. */
  unreachable: boolean;
  readonly connectAttempts: number;
  readonly connected: boolean;
  /** Resolves once a stream is open. */
  whenConnected(): Promise<void>;
}

const noPhase: P1Phase = { powerW: null, currentA: null, voltageV: null };

export function createFakeP1Client(clock: Clock): FakeP1Client {
  let open:
    | { onReading: (reading: P1Reading) => void; end: (reason: string) => void }
    | undefined;
  let connectAttempts = 0;
  const connectedListeners: (() => void)[] = [];

  return {
    unreachable: false,
    get connectAttempts() {
      return connectAttempts;
    },
    get connected() {
      return open !== undefined;
    },
    async connect(onReading) {
      connectAttempts++;
      if (this.unreachable) throw new Error("connect ECONNREFUSED (fake)");
      let end: (reason: string) => void = () => {};
      const closed = new Promise<string>((resolve) => {
        end = (reason) => {
          open = undefined;
          resolve(reason);
        };
      });
      open = { onReading, end };
      for (const listener of connectedListeners.splice(0)) listener();
      return { closed, close: () => end("closed") };
    },
    send({ netPowerW, phases = {}, deviceTimestamp = null }) {
      if (!open) throw new Error("The fake P1 meter is not connected");
      open.onReading({
        receivedAt: clock.now(),
        deviceTimestamp,
        netPowerW,
        phases: { l1: noPhase, l2: noPhase, l3: noPhase, ...phases },
      });
    },
    drop(reason = "connection lost (fake)") {
      open?.end(reason);
    },
    whenConnected() {
      if (open) return Promise.resolve();
      return new Promise((resolve) => {
        connectedListeners.push(resolve);
      });
    },
  };
}
