// src/main/history/historyStore.ts
import type Database from "better-sqlite3";
import type { Session, Turn, Capture, SearchHit } from "@shared/types";

export class HistoryStore {
  constructor(private db: Database.Database) {}

  startSession(model: string, mode = "converse"): Session {
    const now = Date.now();
    const info = this.db.prepare(
      "INSERT INTO sessions (mode, model, started_at, status) VALUES (?, ?, ?, 'active')"
    ).run(mode, model, now);
    return { id: Number(info.lastInsertRowid), mode: mode as Session["mode"], model, startedAt: now, endedAt: null, status: "active" };
  }

  endSession(id: number): void {
    this.db.prepare("UPDATE sessions SET status='ended', ended_at=? WHERE id=?").run(Date.now(), id);
  }

  // Reactivate an ended session so the notch can continue appending turns to the same row.
  reopenSession(id: number): void {
    this.db.prepare("UPDATE sessions SET status='active', ended_at=NULL WHERE id=?").run(id);
  }

  // Close any still-active session (called on quit so nothing is left dangling as 'active').
  endActiveSessions(): void {
    this.db.prepare("UPDATE sessions SET status='ended', ended_at=? WHERE status='active'").run(Date.now());
  }

  addTurn(t: Omit<Turn, "id" | "createdAt">): Turn {
    const now = Date.now();
    const info = this.db.prepare(
      "INSERT INTO turns (session_id, role, source, text, created_at) VALUES (?,?,?,?,?)"
    ).run(t.sessionId, t.role, t.source, t.text, now);
    const id = Number(info.lastInsertRowid);
    this.db.prepare(
      "INSERT INTO search_fts (body, kind, ref_id, session_id, created_at) VALUES (?, 'turn', ?, ?, ?)"
    ).run(t.text, id, t.sessionId, now);
    return { ...t, id, createdAt: now };
  }

  addCapture(c: Omit<Capture, "id" | "createdAt">): Capture {
    const now = Date.now();
    const info = this.db.prepare(
      "INSERT INTO captures (session_id, turn_id, thumb_path, summary, created_at) VALUES (?,?,?,?,?)"
    ).run(c.sessionId, c.turnId, c.thumbPath, c.summary ?? "", now);
    const id = Number(info.lastInsertRowid);
    if (c.summary) {
      this.db.prepare(
        "INSERT INTO search_fts (body, kind, ref_id, session_id, created_at) VALUES (?, 'capture', ?, ?, ?)"
      ).run(c.summary, id, c.sessionId, now);
    }
    return { ...c, summary: c.summary ?? "", id, createdAt: now };
  }

  listSessions(): Session[] {
    return this.db.prepare("SELECT id, mode, model, started_at as startedAt, ended_at as endedAt, status FROM sessions ORDER BY id DESC").all() as Session[];
  }

  listTurns(sessionId: number): Turn[] {
    return this.db.prepare(
      "SELECT id, session_id as sessionId, role, source, text, created_at as createdAt FROM turns WHERE session_id=? ORDER BY id ASC"
    ).all(sessionId) as Turn[];
  }

  listCaptures(sessionId: number): Capture[] {
    return this.db.prepare(
      "SELECT id, session_id as sessionId, turn_id as turnId, thumb_path as thumbPath, summary, created_at as createdAt FROM captures WHERE session_id=? ORDER BY id ASC"
    ).all(sessionId) as Capture[];
  }

  search(query: string): SearchHit[] {
    const match = toFtsMatch(query);
    if (match === null) return []; // empty/whitespace -> no query
    const rows = this.db.prepare(
      "SELECT kind, ref_id as refId, session_id as sessionId, created_at as createdAt, snippet(search_fts, 0, '[', ']', '…', 8) as snippet FROM search_fts WHERE search_fts MATCH ? ORDER BY rank"
    ).all(match) as Array<{ kind: string; refId: number; sessionId: number; createdAt: number; snippet: string }>;
    return rows.map(r => ({
      turnId: r.kind === "turn" ? r.refId : null,
      captureId: r.kind === "capture" ? r.refId : null,
      sessionId: r.sessionId,
      snippet: r.snippet,
      createdAt: r.createdAt,
    }));
  }
}

// Turn arbitrary user text into a safe FTS5 phrase query: trim, then wrap as a
// double-quoted phrase (escaping internal quotes), so operators like * - " never cause syntax errors.
function toFtsMatch(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return `"${trimmed.replace(/"/g, '""')}"`;
}
