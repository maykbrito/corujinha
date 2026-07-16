# Session Management (New + Continue) — Design Spec

**Date:** 2026-07-16
**Status:** Approved, ready to implement
**Builds on:** Phase A local Ollama pipeline

## 1. Summary

Two ways to manage conversations in the notch:

- **New** — a button in the notch that ends the current session and clears the notch, so the next Send starts a fresh session.
- **Continue** — a button on each session in the Dashboard that reopens that session, loads its turns back into the notch, and resumes appending to the **same** DB row.

## 2. Scope

**In scope:**
- `HistoryStore.reopenSession(id)` — set `status='active'`, `ended_at=null`.
- `startConverse(hooks, opts?)` — optional `continueSessionId`: reuse + reopen the session, seed the in-memory context from its turns, and return the loaded turns.
- Notch **New** button + `newSession` action.
- Dashboard **Continue** button per session.
- IPC: `session:continue` (dashboard→main), `history:reopenSession` (notch→main), `notch:continueSession` (main→notch event).

**Out of scope:**
- Fork/seed-into-new (we chose Continue = same session).
- Read-only reload.
- Deleting sessions.
- Phase B notch chrome (these actions survive the rebuild; only the New button gets re-skinned).

## 3. Architecture

### Components

- **HistoryStore.reopenSession(id):** `UPDATE sessions SET status='active', ended_at=NULL WHERE id=?`. No-op if id missing.
- **startConverse(hooks, opts?):**
  - No opts → create a new session (Phase A behavior, unchanged).
  - `opts.continueSessionId` → set `sessionId` to it, `await api.invoke("history:reopenSession", id)`, load `history:listTurns(id)`, seed `context` from the turns (role + text; images are current-turn-only, so old turns are text context). Return the loaded turns.
  - Return value gains `turns: Turn[]` (empty for new sessions, the loaded turns for continued).
- **Notch controller (main.ts):**
  - `newSession()`: `await converse?.stop()`; `converse=null; turns=[]; index=0; statusLabel=""`; render. Next Send lazily creates a fresh session.
  - `continueSession(id)`: `await converse?.stop()` (ends the current one); `converse = await startConverse(hooks, { continueSessionId: id })`; set `turns` to the returned loaded turns, `index = last`; render.
  - Listens for the `notch:continueSession` event → `continueSession(id)`.
- **Dashboard (dashboard/main.ts):** each session row gets a **Continue** button → `api.invoke("session:continue", id)`.
- **Main:** `session:continue` handler shows/focuses the notch and sends it `notch:continueSession(id)`.

### Data flow (Continue)

```
Dashboard [Continue] ─invoke session:continue(id)─▶ main
  main: notch.show(); notch.webContents.send(notch:continueSession, id)
  notch: stop current converse ─▶ startConverse({continueSessionId:id})
     ─▶ history:reopenSession(id) + history:listTurns(id) ─▶ seed context, return turns
  notch: render loaded turns; new Sends append to the same session
```

### Data flow (New)

```
Notch [New] ─▶ converse.stop() (ends DB session) ─▶ clear notch ─▶ converse=null
  next Send ─▶ ensureConverse() ─▶ startConverse() (fresh session)
```

## 4. IPC additions

- `IPC.SESSION_CONTINUE = "session:continue"` — dashboard→main invoke `(id)`.
- `IPC.HISTORY_REOPEN_SESSION = "history:reopenSession"` — notch→main invoke `(id)`.
- `IPC_EVENT.NOTCH_CONTINUE_SESSION = "notch:continueSession"` — main→notch event `(id)`.

## 5. Error handling

- `reopenSession` with a missing id → no-op (the UPDATE affects 0 rows).
- Continued session with no turns → an empty-but-active session; user just starts talking.
- Notch hidden when Continue is clicked → main calls `notch.show()` first.
- `converse?.stop()` when there is no converse → guarded (optional chaining).

## 6. Testing

- **Unit:** `HistoryStore.reopenSession` — reopen an ended session flips it to active with null `ended_at`; missing id is a no-op. (SQLite, sync.)
- **Existing tests stay green** (schema unchanged; only a method added).
- **Manual smoke:** New clears + starts fresh; Continue from Dashboard loads turns and appends to the same session (verify in Dashboard the session stays one row and grows).

## 7. Notes for Phase B

Add `newSession()` and `continueSession(id)` to the Phase B `NotchActions` contract. The New control gets a place in the Cody-style chrome (e.g. a header button); Continue stays in the Dashboard.
