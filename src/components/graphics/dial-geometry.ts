/** Pure geometry for the SystemDial — kept separate so it is unit-testable. */

export interface DialSegment {
  start: number; // degrees, 0 = 12 o'clock, clockwise
  end: number;
}

/** Split the ring into `count` equal arcs with `gapDeg` between neighbours. */
export function dialSegments(count: number, gapDeg = 4): DialSegment[] {
  if (count <= 0) return [];
  if (count === 1) return [{ start: 0, end: 359.99 }]; // a full circle can't be one SVG arc
  const span = 360 / count;
  const gap = Math.min(gapDeg, span / 2);
  return Array.from({ length: count }, (_, i) => ({ start: i * span + gap / 2, end: (i + 1) * span - gap / 2 }));
}

/**
 * Point on a circle. Rounded to 2 decimals because Math.sin/cos may differ in the
 * last bit between the server's and the browser's JS engine, which breaks hydration.
 */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  const round = (n: number) => Math.round(n * 100) / 100;
  return [round(cx + r * Math.cos(rad)), round(cy + r * Math.sin(rad))];
}

/** SVG path for a clockwise arc between two angles. */
export function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  const [x1, y1] = polar(cx, cy, r, start);
  const [x2, y2] = polar(cx, cy, r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}
