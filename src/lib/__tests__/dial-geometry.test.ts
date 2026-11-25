import { describe, expect, it } from "vitest";
import { arcPath, dialSegments, polar } from "../../components/graphics/dial-geometry";

describe("polar", () => {
  it("rounds to 2 decimals so server and browser render identical SVG (hydration)", () => {
    for (let deg = 0; deg < 360; deg += 6) {
      for (const v of polar(100, 100, 96, deg)) expect(Math.round(v * 100) / 100).toBe(v);
    }
  });
});

describe("dialSegments", () => {
  it("returns nothing for no monitors", () => {
    expect(dialSegments(0)).toEqual([]);
  });

  it("uses a near-full circle for one monitor (a 360° SVG arc would vanish)", () => {
    const [only] = dialSegments(1);
    expect(only!.start).toBe(0);
    expect(only!.end).toBeLessThan(360);
  });

  it("splits evenly with gaps and never overlaps", () => {
    const segs = dialSegments(6, 4);
    expect(segs).toHaveLength(6);
    for (let i = 0; i < segs.length; i++) {
      expect(segs[i]!.end - segs[i]!.start).toBeCloseTo(56);
      if (i > 0) expect(segs[i]!.start).toBeGreaterThan(segs[i - 1]!.end);
    }
    expect(segs.at(-1)!.end).toBeLessThan(360);
  });

  it("caps the gap so many monitors still get visible arcs", () => {
    const segs = dialSegments(200, 4);
    expect(segs[0]!.end).toBeGreaterThan(segs[0]!.start);
  });
});

describe("arcPath", () => {
  it("flags the large-arc bit only past 180°", () => {
    expect(arcPath(100, 100, 50, 0, 90)).toContain(" 0 0 1 ");
    expect(arcPath(100, 100, 50, 0, 270)).toContain(" 0 1 1 ");
  });
});
