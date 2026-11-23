export type Point = [number, number];

/**
 * A smooth curve through the points that never overshoots them (monotone
 * cubic, Fritsch-Carlson), so a step in power stays inside its area.
 */
export function smoothLine(points: Point[]): string {
  const [first] = points;
  if (!first) return "";
  const slopes = points.map((_, i) => slopeAt(points, i));
  let path = `M${first[0]},${first[1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i] as Point;
    const [x2, y2] = points[i + 1] as Point;
    const third = (x2 - x1) / 3;
    const m1 = slopes[i] ?? 0;
    const m2 = slopes[i + 1] ?? 0;
    path += ` C${x1 + third},${y1 + m1 * third} ${x2 - third},${y2 - m2 * third} ${x2},${y2}`;
  }
  return path;
}

/** The tangent at point `i`: flat at a peak or a valley, never steeper than its neighbours allow. */
function slopeAt(points: Point[], i: number): number {
  const before = points[i - 1];
  const point = points[i] as Point;
  const after = points[i + 1];
  const secant = (a: Point, b: Point) => (b[1] - a[1]) / (b[0] - a[0]);
  if (!before) return after ? secant(point, after) : 0;
  if (!after) return secant(before, point);
  const left = secant(before, point);
  const right = secant(point, after);
  if (left * right <= 0) return 0;
  const leftWidth = point[0] - before[0];
  const rightWidth = after[0] - point[0];
  const weighted =
    (left * rightWidth + right * leftWidth) / (leftWidth + rightWidth);
  return (
    Math.sign(left) *
    Math.min(2 * Math.abs(left), 2 * Math.abs(right), Math.abs(weighted))
  );
}

/** The area between two smoothed edges over the same x positions. */
export function band(xs: number[], top: number[], bottom: number[]): string {
  const up = xs.map((x, i): Point => [x, top[i] ?? 0]);
  const down = xs.map((x, i): Point => [x, bottom[i] ?? 0]).reverse();
  const [downStart] = down;
  if (!downStart || up.length < 2) return "";
  const downPath = smoothLine(down).replace(/^M[^C]*/, "");
  return `${smoothLine(up)} L${downStart[0]},${downStart[1]}${downPath} Z`;
}
