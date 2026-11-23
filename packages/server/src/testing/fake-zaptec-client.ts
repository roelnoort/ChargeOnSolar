import type { OverrideCommand } from "@charge-on-solar/shared";
import type { Clock } from "../clock.ts";
import type { ChargerReading } from "../domain/charger-reading.ts";
import type { CommandResult, ZaptecClient } from "../zaptec/client.ts";

/** What the fake charger reports; anything left out is idle and unknown. */
export type FakeChargerState = Partial<
  Omit<ChargerReading, "receivedAt" | "rawState" | "phaseCurrentsA">
> & { phaseCurrentsA?: Partial<ChargerReading["phaseCurrentsA"]> };

/** Stands in for the Zaptec cloud: tests decide what it answers, and when it fails. */
export interface FakeZaptecClient extends ZaptecClient {
  /** What every read answers from now on. Until set, reads fail. */
  set(state: FakeChargerState): void;
  /** While true, every read fails. */
  unreachable: boolean;
  readonly readAttempts: number;
  /** Resolves after the next read has answered. */
  whenRead(): Promise<void>;
  /**
   * What every command answers from now on: accepted until set. The charger
   * state does not change by itself; the test sets what it reports next.
   */
  commandResult: CommandResult;
  /** Every command sent, in order. */
  readonly commandsSent: readonly OverrideCommand[];
  /** Holds back every command's answer until the returned function is called. */
  holdCommands(): () => void;
}

export function createFakeZaptecClient(clock: Clock): FakeZaptecClient {
  let state: FakeChargerState | undefined;
  let readAttempts = 0;
  const commandsSent: OverrideCommand[] = [];
  const readListeners: (() => void)[] = [];
  let held: Promise<void> = Promise.resolve();

  function answered() {
    for (const listener of readListeners.splice(0)) listener();
  }

  return {
    unreachable: false,
    commandResult: { accepted: true },
    commandsSent,
    async sendCommand(command) {
      commandsSent.push(command);
      await held;
      return this.commandResult;
    },
    holdCommands() {
      let release = () => {};
      held = new Promise((resolve) => {
        release = resolve;
      });
      return release;
    },
    get readAttempts() {
      return readAttempts;
    },
    set(next) {
      state = next;
    },
    async read() {
      readAttempts++;
      try {
        if (this.unreachable) throw new Error("fetch failed (fake Zaptec)");
        if (!state) throw new Error("No charger state set (fake Zaptec)");
        const { phaseCurrentsA, ...rest } = state;
        return {
          receivedAt: clock.now(),
          chargerPowerW: 0,
          chargingCurrentSetA: null,
          operationMode: 1,
          finalStopActive: false,
          nextScheduleEvent: null,
          phaseSetting: null,
          maxCurrentA: null,
          availableCurrentMode: 0,
          enabledFeatures: null,
          surplusModeActive: null,
          ...rest,
          phaseCurrentsA: { l1: null, l2: null, l3: null, ...phaseCurrentsA },
          rawState: JSON.stringify({ fake: state }),
        };
      } finally {
        queueMicrotask(answered);
      }
    },
    whenRead() {
      return new Promise((resolve) => {
        readListeners.push(resolve);
      });
    },
  };
}
