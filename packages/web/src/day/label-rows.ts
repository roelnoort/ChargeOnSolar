/** A label's left edge and width, in the chart's units. */
export interface LabelBox {
  x: number;
  width: number;
}

/**
 * Which row each label goes on, left to right: the first row where it clears
 * the label before it, or undefined when no row has room. `labels` are in
 * order of `x`.
 */
export function labelRows(
  labels: LabelBox[],
  rows: number
): (number | undefined)[] {
  const freeFrom = Array.from({ length: rows }, () => Number.NEGATIVE_INFINITY);
  return labels.map(({ x, width }) => {
    const row = freeFrom.findIndex((from) => from <= x);
    if (row === -1) return undefined;
    freeFrom[row] = x + width;
    return row;
  });
}
