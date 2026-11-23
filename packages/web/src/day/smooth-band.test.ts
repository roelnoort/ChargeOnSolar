import { describe, expect, it } from "vitest";
import { smoothLine } from "./smooth-band.ts";

/** Every y a path's points and control points reach. */
function ysOf(path: string): number[] {
  return [...path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((match) =>
    Number(match[2])
  );
}

describe("the smoothed edge of a Real chart area", () => {
  it("does not overshoot a step, so an area never pokes past its neighbours", () => {
    // A car that starts charging: 0 W, then 3700 W, held.
    const path = smoothLine([
      [0, 200],
      [10, 200],
      [20, 200],
      [30, 50],
      [40, 50],
      [50, 50],
    ]);

    expect(Math.max(...ysOf(path))).toBe(200);
    expect(Math.min(...ysOf(path))).toBe(50);
  });

  it("starts and ends on the first and last points", () => {
    const path = smoothLine([
      [0, 100],
      [10, 80],
      [20, 90],
    ]);

    expect(path.startsWith("M0,100")).toBe(true);
    expect(path.endsWith("20,90")).toBe(true);
  });
});
