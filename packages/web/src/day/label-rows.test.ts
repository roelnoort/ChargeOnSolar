import { describe, expect, it } from "vitest";
import { labelRows } from "./label-rows.ts";

describe("stacking labels above a chart", () => {
  it("keeps labels on the top row while they do not overlap", () => {
    expect(
      labelRows(
        [
          { x: 10, width: 50 },
          { x: 70, width: 50 },
        ],
        3
      )
    ).toEqual([0, 0]);
  });

  it("moves a label down to the first row it fits in", () => {
    expect(
      labelRows(
        [
          { x: 10, width: 50 },
          { x: 30, width: 50 },
          { x: 50, width: 50 },
          { x: 65, width: 50 },
        ],
        3
      )
    ).toEqual([0, 1, 2, 0]);
  });

  it("has no row for a label when none has room", () => {
    expect(
      labelRows(
        [
          { x: 10, width: 50 },
          { x: 11, width: 50 },
          { x: 12, width: 50 },
        ],
        2
      )
    ).toEqual([0, 1, undefined]);
  });
});
