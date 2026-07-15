// tests/session/sessionState.test.ts
import { describe, it, expect } from "vitest";
import { transition } from "../../src/shared/session/sessionState";

describe("sessionState", () => {
  it("starts from idle", () => {
    expect(transition("idle", "start")).toBe("active");
  });
  it("pauses and resumes", () => {
    expect(transition("active", "pause")).toBe("paused");
    expect(transition("paused", "resume")).toBe("active");
  });
  it("stops from active or paused", () => {
    expect(transition("active", "stop")).toBe("ended");
    expect(transition("paused", "stop")).toBe("ended");
  });
  it("rejects invalid transitions", () => {
    expect(() => transition("idle", "pause")).toThrow();
    expect(() => transition("ended", "start")).toThrow();
  });
});
