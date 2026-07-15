// tests/session/pagination.test.ts
import { describe, it, expect } from "vitest";
import { clampIndex, pageFor } from "../../src/shared/session/pagination";

describe("pagination", () => {
  it("clamps index within bounds", () => {
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(1, 3)).toBe(1);
  });
  it("clamps to 0 when empty", () => {
    expect(clampIndex(0, 0)).toBe(0);
  });
  it("returns current item + nav flags", () => {
    const items = ["a", "b", "c"];
    expect(pageFor(items, 0)).toEqual({ item: "a", index: 0, total: 3, hasPrev: false, hasNext: true });
    expect(pageFor(items, 2)).toEqual({ item: "c", index: 2, total: 3, hasPrev: true, hasNext: false });
  });
  it("handles empty list", () => {
    expect(pageFor([], 0)).toEqual({ item: null, index: 0, total: 0, hasPrev: false, hasNext: false });
  });
});
