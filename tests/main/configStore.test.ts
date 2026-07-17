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
  it("defaults hideFromCapture on (content protection by default)", () => {
    const cs = new ConfigStore(fakeDisk());
    expect(cs.get().hideFromCapture).toBe(true);
  });
  it("merges a legacy file lacking hideFromCapture over the default", () => {
    const cs = new ConfigStore(fakeDisk(JSON.stringify({ model: "llava:13b" })));
    expect(cs.get().hideFromCapture).toBe(true); // filled from DEFAULT_CONFIG
    expect(cs.get().model).toBe("llava:13b");
  });
  it("round-trips a partial set (merged over current)", () => {
    const cs = new ConfigStore(fakeDisk());
    const next = cs.set({ model: "llava:13b" });
    expect(next).toEqual({ ...DEFAULT_CONFIG, model: "llava:13b" });
    expect(cs.get()).toEqual(next);
  });
  it("falls back to defaults on a malformed file", () => {
    const cs = new ConfigStore(fakeDisk("{not json"));
    expect(cs.get()).toEqual(DEFAULT_CONFIG);
  });
});
