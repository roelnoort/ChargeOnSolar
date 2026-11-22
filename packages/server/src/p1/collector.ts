import type { Cancel, Clock } from "../clock.ts";
import type { P1Reading } from "../domain/p1-reading.ts";
import { type BackOff, backOffMs, messageOf } from "../supervision.ts";
import type { P1Client, P1Connection } from "./client.ts";

export interface P1CollectorOptions {
  client: P1Client;
  clock: Clock;
  log: (line: string) => void;
  onReading: (reading: P1Reading) => void;
}

export interface P1Collector {
  stop(): void;
}

const retryBackOff: BackOff = { firstMs: 1000, longestMs: 60_000 };

/**
 * Keeps the P1 stream open: reconnects with back-off whenever it drops or
 * cannot be opened. Never throws, so a P1 outage cannot take the server down.
 */
export function startP1Collector({
  client,
  clock,
  log,
  onReading,
}: P1CollectorOptions): P1Collector {
  let stopped = false;
  let connection: P1Connection | undefined;
  let cancelWait: Cancel | undefined;
  let wakeUp: (() => void) | undefined;

  function wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      wakeUp = resolve;
      cancelWait = clock.after(milliseconds, resolve);
    });
  }

  async function run() {
    let failures = 0;
    while (!stopped) {
      let received = false;
      try {
        connection = await client.connect((reading) => {
          received = true;
          try {
            onReading(reading);
          } catch (error) {
            log(`P1 Reading not handled: ${messageOf(error)}`);
          }
        });
        if (stopped) connection.close();
        log("P1 meter connected");
        log(`P1 meter disconnected: ${await connection.closed}`);
      } catch (error) {
        log(`P1 meter unreachable: ${messageOf(error)}`);
      }
      connection = undefined;
      if (stopped) break;
      failures = received ? 1 : failures + 1;
      const delay = backOffMs(retryBackOff, failures);
      log(`Reconnecting to the P1 meter in ${delay / 1000} s`);
      await wait(delay);
    }
  }

  void run();

  return {
    stop() {
      stopped = true;
      cancelWait?.();
      wakeUp?.();
      connection?.close();
    },
  };
}
