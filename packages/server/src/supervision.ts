/** How the collectors wait after failures in a row: doubling, up to a cap. */
export interface BackOff {
  firstMs: number;
  longestMs: number;
}

/** How long to wait before the next attempt, after `failures` in a row. */
export function backOffMs({ firstMs, longestMs }: BackOff, failures: number) {
  return Math.min(firstMs * 2 ** (failures - 1), longestMs);
}

/** The text of an error a collector logs. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
