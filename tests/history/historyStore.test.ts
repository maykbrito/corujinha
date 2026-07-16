// tests/history/historyStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { HistoryStore } from "../../src/main/history/historyStore";
import { openDatabase } from "../../src/main/history/db";

const schema = readFileSync("src/main/history/schema.sql", "utf8");

function freshStore() {
  const db = openDatabase(":memory:", schema);
  return new HistoryStore(db);
}

describe("HistoryStore", () => {
  let store: HistoryStore;
  beforeEach(() => { store = freshStore(); });

  it("creates a session and returns it as active", () => {
    const s = store.startSession("gpt-realtime-2.1");
    expect(s.id).toBeGreaterThan(0);
    expect(s.status).toBe("active");
    expect(s.mode).toBe("converse");
  });

  it("appends turns in order and lists them", () => {
    const s = store.startSession("m");
    store.addTurn({ sessionId: s.id, role: "user", source: "voice", text: "hello" });
    store.addTurn({ sessionId: s.id, role: "assistant", source: "voice", text: "hi there" });
    const turns = store.listTurns(s.id);
    expect(turns.map(t => t.text)).toEqual(["hello", "hi there"]);
  });

  it("stores a capture with an empty summary fallback", () => {
    const s = store.startSession("m");
    const c = store.addCapture({ sessionId: s.id, turnId: null, thumbPath: "/tmp/a.webp", summary: "" });
    expect(c.summary).toBe("");
    expect(c.thumbPath).toBe("/tmp/a.webp");
  });

  it("ends a session", () => {
    const s = store.startSession("m");
    store.endSession(s.id);
    const found = store.listSessions().find(x => x.id === s.id)!;
    expect(found.status).toBe("ended");
    expect(found.endedAt).not.toBeNull();
  });

  it("full-text searches turn text and capture summaries", () => {
    const s = store.startSession("m");
    store.addTurn({ sessionId: s.id, role: "assistant", source: "voice", text: "explain the load balancer" });
    store.addCapture({ sessionId: s.id, turnId: null, thumbPath: "/tmp/b.webp", summary: "diagram of a cache layer" });
    expect(store.search("balancer").length).toBe(1);
    expect(store.search("cache").length).toBe(1);
    expect(store.search("nonexistentword").length).toBe(0);
  });

  it("sanitizes FTS input so special characters and empty queries never throw", () => {
    const s = store.startSession("m");
    store.addTurn({ sessionId: s.id, role: "user", source: "typed", text: `use a "quoted" term and a-hyphen` });
    expect(() => store.search(`"`)).not.toThrow();
    expect(() => store.search(`a-hyphen`)).not.toThrow();
    expect(() => store.search(`*`)).not.toThrow();
    expect(store.search("   ")).toEqual([]);   // whitespace/empty -> no query, empty result
    expect(store.search("quoted").length).toBe(1);
  });

  it("populates the correct hit fields for turn vs capture matches", () => {
    const s = store.startSession("m");
    const t = store.addTurn({ sessionId: s.id, role: "assistant", source: "voice", text: "quorum consensus" });
    const c = store.addCapture({ sessionId: s.id, turnId: null, thumbPath: "/tmp/d.webp", summary: "raft leader election" });

    const turnHit = store.search("quorum")[0];
    expect(turnHit.turnId).toBe(t.id);
    expect(turnHit.captureId).toBeNull();
    expect(turnHit.sessionId).toBe(s.id);
    expect(turnHit.snippet).toContain("quorum");

    const capHit = store.search("raft")[0];
    expect(capHit.captureId).toBe(c.id);
    expect(capHit.turnId).toBeNull();
  });

  it("isolates turns and orders sessions across multiple sessions", () => {
    const s1 = store.startSession("m");
    const s2 = store.startSession("m");
    store.addTurn({ sessionId: s1.id, role: "user", source: "typed", text: "one" });
    store.addTurn({ sessionId: s2.id, role: "user", source: "typed", text: "two" });
    expect(store.listTurns(s1.id).map(t => t.text)).toEqual(["one"]);
    expect(store.listTurns(s2.id).map(t => t.text)).toEqual(["two"]);
    expect(store.listSessions()[0].id).toBe(s2.id); // most recent first
  });

  it("lists captures for a session in order, isolated from other sessions", () => {
    const s = store.startSession("m");
    const a = store.addCapture({ sessionId: s.id, turnId: null, thumbPath: "/tmp/1.webp", summary: "first" });
    const b = store.addCapture({ sessionId: s.id, turnId: null, thumbPath: "/tmp/2.webp", summary: "" });
    const other = store.startSession("m");
    store.addCapture({ sessionId: other.id, turnId: null, thumbPath: "/tmp/3.webp", summary: "other" });
    const caps = store.listCaptures(s.id);
    expect(caps.map((c) => c.id)).toEqual([a.id, b.id]);
    expect(caps.map((c) => c.thumbPath)).toEqual(["/tmp/1.webp", "/tmp/2.webp"]);
    expect(caps[1].summary).toBe("");
  });
});
