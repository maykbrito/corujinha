import { describe, it, expect } from "vitest";
import { decideCapture } from "../../src/shared/decideCapture";

describe("decideCapture", () => {
  it("region attachment wins even when toggle is off", () => {
    expect(decideCapture({ hasRegion: true, sendScreen: false })).toBe("region");
  });
  it("full screen when toggle on and no region", () => {
    expect(decideCapture({ hasRegion: false, sendScreen: true })).toBe("full");
  });
  it("text-only when toggle off and no region", () => {
    expect(decideCapture({ hasRegion: false, sendScreen: false })).toBe("none");
  });
});
