import { describe, it, expect } from "vitest";
import { ConfigStore, DEFAULT_CONFIG } from "../../src/main/config/configStore";

function fakeDisk(initial: string | null = null) {
  let file = initial;
  return { read: () => file, write: (s: string) => { file = s; }, peek: () => file };
}

describe("ConfigStore", () => {
  it("returns defaults when no file exists", () => {
    const cs = new ConfigStore(fakeDisk());
    expect(cs.get()).toEqual(DEFAULT_CONFIG);
  });
  it("round-trips a partial set (merged over current)", () => {
    const cs = new ConfigStore(fakeDisk());
    const next = cs.set({ model: "llava:13b" });
    expect(next).toEqual({ ollamaUrl: DEFAULT_CONFIG.ollamaUrl, model: "llava:13b" });
    expect(cs.get()).toEqual(next);
  });
  it("falls back to defaults on a malformed file", () => {
    const cs = new ConfigStore(fakeDisk("{not json"));
    expect(cs.get()).toEqual(DEFAULT_CONFIG);
  });
});
