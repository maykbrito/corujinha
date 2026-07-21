import { describe, it, expect } from "vitest";
import { toPixelCrop } from "../../src/shared/cropRect";

describe("toPixelCrop", () => {
  it("scales CSS-point selection to frame pixels", () => {
    const r = toPixelCrop(
      { x: 10, y: 20, w: 100, h: 50 },
      { scaleFactor: 2, pointW: 800, pointH: 600 },
      { frameW: 1600, frameH: 1200 },
    );
    expect(r).toEqual({ x: 20, y: 40, w: 200, h: 100 });
  });

  it("clamps to frame bounds and never returns negative/zero size", () => {
    const r = toPixelCrop(
      { x: -5, y: -5, w: 5000, h: 5000 },
      { scaleFactor: 1, pointW: 1000, pointH: 800 },
      { frameW: 1000, frameH: 800 },
    );
    expect(r).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
  });
});
