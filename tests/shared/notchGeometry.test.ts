import { describe, it, expect } from "vitest";
import { clampSize, clampOpacity, snapDistance, notchBounds, NOTCH } from "../../src/shared/notchGeometry";

describe("notchGeometry", () => {
  it("clamps size within min/max", () => {
    expect(clampSize({ width: 10, height: 10 })).toEqual({ width: NOTCH.MIN_W, height: NOTCH.MIN_H });
    expect(clampSize({ width: 9999, height: 9999 })).toEqual({ width: NOTCH.MAX_W, height: NOTCH.MAX_H });
    expect(clampSize({ width: 500, height: 300 })).toEqual({ width: 500, height: 300 });
  });
  it("clamps opacity within 0.45..1", () => {
    expect(clampOpacity(0)).toBe(0.45);
    expect(clampOpacity(2)).toBe(1);
    expect(clampOpacity(0.7)).toBe(0.7);
  });
  it("computes euclidean snap distance", () => {
    expect(snapDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
  it("centers the pill at the top of the work area", () => {
    const b = notchBounds({ x: 0, y: 0, width: 1440, height: 900 }, 300);
    expect(b).toEqual({ x: Math.round(720 - 150), y: 0, width: 300, height: NOTCH.COLLAPSED_H });
  });
  it("recenters a pinned panel on resize (x tracks the new width)", () => {
    const area = { x: 0, y: 0, width: 1440, height: 900 };
    const b = notchBounds(area, 600);
    expect(b.x).toBe(Math.round((1440 - 600) / 2)); // 420
  });
});
