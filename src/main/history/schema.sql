-- src/main/history/schema.sql
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL DEFAULT 'converse',
  model TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  source TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, id);

CREATE TABLE IF NOT EXISTS captures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id INTEGER REFERENCES turns(id) ON DELETE SET NULL,
  thumb_path TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- Full-text search over turn text and capture summaries.
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  body,
  kind UNINDEXED,     -- 'turn' | 'capture'
  ref_id UNINDEXED,   -- turns.id or captures.id
  session_id UNINDEXED,
  created_at UNINDEXED
);
