import { describe, it, expect } from "vitest";
import { parseFollowUps } from "../../src/shared/followUps";

describe("parseFollowUps", () => {
  it("splits lines and trims", () => {
    expect(parseFollowUps("What is X?\nHow does Y work?")).toEqual(["What is X?", "How does Y work?"]);
  });
  it("strips numbering, bullets, and wrapping quotes", () => {
    expect(parseFollowUps("1. What is X?\n- How is Y?\n* Why Z?\n\"Quote me\"")).toEqual([
      "What is X?", "How is Y?", "Why Z?",
    ]);
  });
  it("caps at 3 and drops empties", () => {
    expect(parseFollowUps("a\n\nb\n\nc\n\nd")).toEqual(["a", "b", "c"]);
  });
  it("de-duplicates case-insensitively", () => {
    expect(parseFollowUps("Same?\nsame?\nOther?")).toEqual(["Same?", "Other?"]);
  });
  it("drops the idle protocol (…/...)", () => {
    expect(parseFollowUps("...\n…\nReal question?")).toEqual(["Real question?"]);
  });
  it("returns [] for empty/undefined input", () => {
    expect(parseFollowUps("")).toEqual([]);
    expect(parseFollowUps(undefined as unknown as string)).toEqual([]);
  });
});
