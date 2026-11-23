/**
 * A live value that changes now and then, such as Surplus: each value holds
 * until the next one arrives. Averages weigh each value by how long it held,
 * so a quiet minute and a busy one count the same.
 */
export class StepSeries {
  #points: { at: number; value: number | null }[] = [];

  /** The value from `at` on; null while it is unknown. */
  add(at: Date, value: number | null): void {
    this.#points.push({ at: at.getTime(), value });
  }

  /**
   * The time-weighted mean over `[from, to]`, leaving out the spans where
   * the value was unknown. Null when it was unknown throughout.
   */
  average(from: Date, to: Date): number | null {
    const start = from.getTime();
    const end = to.getTime();
    let weighted = 0;
    let known = 0;
    this.#points.forEach((point, index) => {
      if (point.value === null) return;
      const until = this.#points[index + 1]?.at ?? end;
      const span = Math.min(until, end) - Math.max(point.at, start);
      if (span <= 0) return;
      weighted += point.value * span;
      known += span;
    });
    return known === 0 ? null : weighted / known;
  }

  /** Drops what no average from `at` on can need. */
  forgetBefore(at: Date): void {
    const cutoff = at.getTime();
    while ((this.#points[1]?.at ?? Number.POSITIVE_INFINITY) <= cutoff) {
      this.#points.shift();
    }
  }
}
