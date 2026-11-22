import type { Cancel, Clock } from "../clock.ts";
import type { ChargerReading } from "../domain/charger-reading.ts";
import type { ZaptecClient } from "./client.ts";

export interface ZaptecCollectorOptions {
  client: ZaptecClient;
  clock: Clock;
  log: (line: string) => void;
  onReading: (reading: ChargerReading) => void;
}

export interface ZaptecCollector {
  stop(): void;
}

// Zaptec advises against aggressive polling of charger state but gives no
// number; two requests every 30 s stays far below its 10 requests a second.
export const zaptecPollIntervalMs = 30_000;
const longestRetryMs = 10 * 60_000;

/** How long to wait before the next attempt, after `failures` in a row. */
export function zaptecRetryDelayMs(failures: number): number {
  return Math.min(zaptecPollIntervalMs * 2 ** (failures - 1), longestRetryMs);
}

/**
 * Reads Zaptec every poll interval, backing off while it fails. Never throws,
 * so a Zaptec outage cannot take the server or the P1 collector down.
 */
export function startZaptecCollector({
  client,
  clock,
  log,
  onReading,
}: ZaptecCollectorOptions): ZaptecCollector {
  let stopped = false;
  let failures = 0;
  let cancelNext: Cancel | undefined;

  async function poll() {
    cancelNext = undefined;
    let reading: ChargerReading | undefined;
    try {
      reading = await client.read();
    } catch (error) {
      failures++;
      log(`Zaptec unreachable: ${messageOf(error)}`);
    }
    if (stopped) return;
    if (reading) {
      if (failures > 0) log("Zaptec reachable again");
      failures = 0;
      try {
        onReading(reading);
      } catch (error) {
        log(`Zaptec Reading not handled: ${messageOf(error)}`);
      }
    }
    const delay =
      failures === 0 ? zaptecPollIntervalMs : zaptecRetryDelayMs(failures);
    if (failures > 0) log(`Reading Zaptec again in ${delay / 1000} s`);
    cancelNext = clock.after(delay, () => void poll());
  }

  void poll();

  return {
    stop() {
      stopped = true;
      cancelNext?.();
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
