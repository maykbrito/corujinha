# See-and-Talk (v1: Converse) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 Converse experience — a macOS Electron app whose floating notch panel holds a live OpenAI Realtime voice conversation that sees your screen every turn, with durable SQLite history and a searchable dashboard.

**Architecture:** Electron main process owns config, auth token minting, screen capture, SQLite, permissions, tray, and global shortcuts. A transparent always-on-top **notch** renderer owns the WebRTC Realtime session and all live UI. Separate **dashboard** and **settings** renderers read/write history over IPC. All durable state lives in SQLite (`better-sqlite3`) with FTS5 search. Pure logic (history repository, turn pagination, session state machine, Realtime event→turn mapping, tool handlers) is unit-tested with Vitest; hardware/permission-bound glue (WebRTC, capture, playback) is verified by manual smoke steps.

**Tech Stack:** TypeScript · Electron · electron-vite · Vitest · better-sqlite3 (FTS5) · OpenAI Realtime API (`gpt-realtime-2.1`) over WebRTC (`@openai/agents-realtime`) · Electron `safeStorage`, `desktopCapturer`, `globalShortcut`, `Tray`.

**Spec:** `docs/superpowers/specs/2026-07-15-see-and-talk-design.md`

**Conventions for every task:** exact paths; write the failing test first; run it and see it fail; implement the minimum; run it green; commit. Keep files focused (one responsibility). Commit messages use Conventional Commits.

---

## File Structure

```
see-and-talk/
  package.json                    # deps, scripts
  electron.vite.config.ts         # main/preload/renderer build
  tsconfig.json                   # TS config
  vitest.config.ts                # test config (node env)
  resources/
    trayTemplate.png              # 16x16 template menu-bar icon
  src/
    shared/
      ipcChannels.ts              # IPC channel-name constants
      types.ts                    # shared domain + IPC payload types
      session/                    # PURE logic, imported by BOTH main and renderer
        sessionState.ts           # pure start/pause/stop state machine
        pagination.ts             # pure turn pagination
        realtimeEvents.ts         # pure Realtime-event -> domain mapping
    main/
      index.ts                    # app lifecycle + orchestration
      ipc.ts                      # registers IPC handlers -> services
      tray.ts                     # menu-bar tray
      shortcuts.ts                # global shortcuts
      permissions.ts              # mic + screen-recording status/prompt
      keyStore.ts                 # safeStorage-backed API key
      tokenMinter.ts              # POST /v1/realtime/client_secrets
      screenCapturer.ts           # drives capture worker, returns WebP data URL
      windows/
        notchWindow.ts
        dashboardWindow.ts
        settingsWindow.ts
        captureWorker.ts          # hidden offscreen capture+encode window
      history/
        db.ts                     # connection + schema bootstrap (schema imported ?raw)
        schema.sql                # tables + FTS5
        historyStore.ts           # repository (sessions/turns/captures/search)
    preload/
      index.ts                    # contextBridge API surface
    renderer/
      notch/{index.html, main.ts, realtime.ts, ui.ts, styles.css}
      dashboard/{index.html, main.ts, styles.css}
      settings/{index.html, main.ts, styles.css}
      captureWorker/{index.html, main.ts}
  tests/
    history/historyStore.test.ts
    session/pagination.test.ts
    session/sessionState.test.ts
    session/realtimeEvents.test.ts
    main/keyStore.test.ts
```

> **Note on pure `session/` modules:** they live in `src/shared/session/` because **both** the main
> process (persistence, IPC) and the notch renderer (WebRTC wrapper, UI) import them. Import via the
> `@shared/session/...` alias everywhere — never copy them, and never use a cross-tree
> `@shared/../main/...` path.

---

## Chunk 1: Project scaffold & tooling

**Outcome:** `npm run dev` opens an empty transparent notch window and a tray icon; `npm test` runs Vitest; TypeScript compiles.

### Task 1.1: Initialize package, TypeScript, and Vitest

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`, `vitest.config.ts`

- [ ] **Step 1: Install toolchain**

```bash
npm install --save-dev electron-vite vite typescript @types/node vitest electron-builder
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
npm install @openai/agents-realtime
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] },
    "outDir": "out"
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  resolve: { alias: { "@shared": resolve(__dirname, "src/shared") } },
});
```

- [ ] **Step 4: Add scripts to `package.json`**

```json
{
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 5: Verify Vitest runs (no tests yet)**

Run: `npm test`
Expected: Vitest reports "No test files found" and exits 0 (thanks to `--passWithNoTests`).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts
git commit -m "chore: scaffold TypeScript + electron-vite + Vitest toolchain"
```

### Task 1.2: electron-vite config with three renderers + preload

**Files:**
- Create: `electron.vite.config.ts`

- [ ] **Step 1: Write the config**

```ts
import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()], // keep better-sqlite3 external (native)
    resolve: { alias: { "@shared": resolve("src/shared") } },
    build: { rollupOptions: { input: resolve("src/main/index.ts") } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve("src/preload/index.ts") } },
  },
  renderer: {
    resolve: { alias: { "@shared": resolve("src/shared") } },
    build: {
      rollupOptions: {
        input: {
          notch: resolve("src/renderer/notch/index.html"),
          dashboard: resolve("src/renderer/dashboard/index.html"),
          settings: resolve("src/renderer/settings/index.html"),
          captureWorker: resolve("src/renderer/captureWorker/index.html"),
        },
      },
    },
  },
});
```

- [ ] **Step 2: Rebuild better-sqlite3 for Electron + add ABI-switch hooks**

`better-sqlite3` compiles to one ABI at a time. Vitest runs under **Node**; Electron runtime needs the **Electron** ABI. Add script hooks so each command self-heals the native binary:
```json
"predev": "electron-builder install-app-deps",
"prebuild": "electron-builder install-app-deps",
"pretest": "npm rebuild better-sqlite3",
"postinstall": "electron-builder install-app-deps"
```
Run: `npm run postinstall`
Expected: better-sqlite3 rebuilt against Electron's ABI, no errors. `npm test` will then rebuild it for Node automatically before running.

- [ ] **Step 3: Commit**

```bash
git add electron.vite.config.ts package.json
git commit -m "chore: electron-vite config for notch/dashboard/settings/capture renderers"
```

### Task 1.3: Shared IPC channel + type definitions

**Files:**
- Create: `src/shared/ipcChannels.ts`, `src/shared/types.ts`

- [ ] **Step 1: Write channel constants**

```ts
// src/shared/ipcChannels.ts
export const IPC = {
  // history
  HISTORY_START_SESSION: "history:startSession",
  HISTORY_END_SESSION: "history:endSession",
  HISTORY_ADD_TURN: "history:addTurn",
  HISTORY_ADD_CAPTURE: "history:addCapture",
  HISTORY_SET_CAPTURE_SUMMARY: "history:setCaptureSummary",
  HISTORY_LIST_SESSIONS: "history:listSessions",
  HISTORY_LIST_TURNS: "history:listTurns",
  HISTORY_SEARCH: "history:search",
  // auth/config
  KEY_GET_STATUS: "key:status",
  KEY_SET: "key:set",
  TOKEN_MINT: "token:mint",
  // capture
  CAPTURE_SCREEN: "capture:screen",
  // notch window control
  NOTCH_SET_FOCUSABLE: "notch:setFocusable",
  // permissions
  PERM_STATUS: "perm:status",
  PERM_REQUEST: "perm:request",
} as const;
```

- [ ] **Step 2: Write domain + payload types**

```ts
// src/shared/types.ts
export type SessionMode = "converse"; // v2: "watch_along" | "call"
export type TurnRole = "user" | "assistant";
export type TurnSource = "voice" | "typed";

export interface Session { id: number; mode: SessionMode; model: string; startedAt: number; endedAt: number | null; status: "active" | "ended"; }
export interface Turn { id: number; sessionId: number; role: TurnRole; source: TurnSource; text: string; createdAt: number; }
export interface Capture { id: number; sessionId: number; turnId: number | null; thumbPath: string; summary: string; createdAt: number; }

export interface SearchHit { turnId: number | null; captureId: number | null; sessionId: number; snippet: string; createdAt: number; }

export interface EphemeralToken { value: string; expiresAt: number; }
export interface KeyStatus { hasKey: boolean; }
export interface PermissionStatus { microphone: "granted" | "denied" | "not-determined"; screen: "granted" | "denied" | "not-determined"; }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/shared
git commit -m "feat: shared IPC channel names and domain types"
```

### Task 1.4: Minimal main process, notch window, and tray

**Files:**
- Create: `src/main/index.ts`, `src/main/windows/notchWindow.ts`, `src/main/tray.ts`, `src/preload/index.ts`, `src/renderer/notch/index.html`, `src/renderer/notch/main.ts`, `src/renderer/notch/styles.css`
- Create: `resources/trayTemplate.png` (16×16 template icon)

- [ ] **Step 0: Add a tray icon asset**

Create a simple 16×16 (and @2x 32×32) black-on-transparent PNG named `resources/trayTemplate.png`. macOS treats files ending in `Template` as template images (auto light/dark). If you don't have art, generate a plain filled circle PNG — anything non-empty so the menu-bar item is visible. Ensure electron-vite copies `resources/` into the build (add it to `build.rollupOptions` assets or reference via `app.getAppPath()`), or load it with an absolute path from `process.resourcesPath` in production.

- [ ] **Step 1: Notch window factory**

```ts
// src/main/windows/notchWindow.ts
import { BrowserWindow, screen } from "electron";
import { join } from "path";

export function createNotchWindow(): BrowserWindow {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: 360,
    height: 220,
    x: Math.round(width / 2 - 180),
    y: 0,
    frame: false,
    transparent: true,
    resizable: true,
    hasShadow: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    type: "panel", // macOS: non-activating panel so listening never steals app focus
    webPreferences: { preload: join(__dirname, "../preload/index.js") },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/notch/index.html`);
  } else {
    win.loadFile(join(__dirname, "../renderer/notch/index.html"));
  }
  return win;
}
```

> **`focusable: false` vs the type box:** a non-focusable window can't receive keyboard input, which
> the Chunk 6 type box needs. We keep `focusable:false` by default (so listening never steals focus)
> and temporarily call `win.setFocusable(true)` + `win.focus()` while the type box is active, then
> revert on blur. This toggle is wired via IPC in Chunk 6 (Task 6.3). Do not "fix" it by making the
> window permanently focusable.

- [ ] **Step 2: Tray**

```ts
// src/main/tray.ts
import { Tray, Menu, nativeImage, app } from "electron";
import { join } from "path";

function trayIcon() {
  const dev = !!process.env["ELECTRON_RENDERER_URL"];
  const path = dev ? join(app.getAppPath(), "resources/trayTemplate.png")
                   : join(process.resourcesPath, "trayTemplate.png");
  const img = nativeImage.createFromPath(path);
  img.setTemplateImage(true);
  return img;
}

export function createTray(handlers: { openDashboard: () => void; openSettings: () => void }): Tray {
  const tray = new Tray(trayIcon());
  tray.setToolTip("See-and-Talk");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Dashboard", click: handlers.openDashboard },
    { label: "Settings", click: handlers.openSettings },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]));
  return tray;
}
```

- [ ] **Step 3: Main entry (wires notch + tray; dashboard/settings stubbed)**

```ts
// src/main/index.ts
import { app, BrowserWindow } from "electron";
import { createNotchWindow } from "./windows/notchWindow";
import { createTray } from "./tray";

let notch: BrowserWindow | null = null;

app.whenReady().then(() => {
  notch = createNotchWindow();
  createTray({
    openDashboard: () => { /* wired in Chunk 7 */ },
    openSettings: () => { /* wired in Chunk 7 */ },
  });
});

app.on("window-all-closed", () => { /* keep running in tray on macOS */ });
```

- [ ] **Step 4: Preload stub (expanded later)**

```ts
// src/preload/index.ts
import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("api", {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, cb: (...args: unknown[]) => void) => ipcRenderer.on(channel, (_e, ...a) => cb(...a)),
});
```

- [ ] **Step 5: Notch renderer shell**

```html
<!-- src/renderer/notch/index.html -->
<!doctype html><html><head><meta charset="utf-8" />
<link rel="stylesheet" href="./styles.css" /></head>
<body><div id="app">See-and-Talk</div><script type="module" src="./main.ts"></script></body></html>
```

```css
/* src/renderer/notch/styles.css */
html,body{margin:0;background:transparent;color:#eee;font:12px -apple-system,system-ui}
#app{background:#000;border-radius:0 0 20px 20px;padding:14px 16px;-webkit-app-region:drag}
```

```ts
// src/renderer/notch/main.ts
console.log("notch renderer up");
```

- [ ] **Step 6: Smoke test**

Run: `npm run dev`
Expected: a small black rounded panel at top-center of the screen, floating above other windows; a tray icon with Dashboard/Settings/Quit. No dock window required. (If the transparent window is invisible, confirm `transparent:true` + background transparent CSS.)

- [ ] **Step 7: Commit**

```bash
git add src/main src/preload src/renderer/notch
git commit -m "feat: minimal notch window, tray, and preload bridge"
```

---

## Chunk 2: History store (SQLite + FTS5)

**Outcome:** A fully unit-tested `HistoryStore` that persists sessions, turns, and captures, and does FTS5 search — the durable source of truth. Runs in Node (Vitest) against a temp DB file.

### Task 2.1: Schema

**Files:**
- Create: `src/main/history/schema.sql`

- [ ] **Step 1: Write the schema**

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add src/main/history/schema.sql
git commit -m "feat: SQLite schema for sessions, turns, captures, FTS5 search"
```

### Task 2.2: DB connection + schema bootstrap

**Files:**
- Create: `src/main/history/db.ts`

The schema must be **bundled**, not read from disk at runtime (a runtime `readFileSync(__dirname/schema.sql)` breaks in the electron-vite production bundle — the `.sql` file isn't copied next to `out/main/index.js`). Import it as a raw string via Vite's `?raw` suffix so it's inlined at build time. Tests can still pass a schema override.

- [ ] **Step 1: Declare the `?raw` module type** (so TS accepts the import)

```ts
// src/shared/raw.d.ts
declare module "*.sql?raw" { const content: string; export default content; }
```

- [ ] **Step 2: Write the connection helper**

```ts
// src/main/history/db.ts
import Database from "better-sqlite3";
import schemaSql from "./schema.sql?raw"; // inlined at build time by electron-vite

export function openDatabase(filePath: string, schemaOverride?: string): Database.Database {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(schemaOverride ?? schemaSql);
  return db;
}
```

Tests call `openDatabase(":memory:", schema)` with the schema string they read directly, so they
never depend on bundler behavior. Production calls `openDatabase(path)` and uses the inlined schema.

- [ ] **Step 3: Commit**

```bash
git add src/main/history/db.ts src/shared/raw.d.ts
git commit -m "feat: SQLite connection + build-inlined schema bootstrap"
```

### Task 2.3: HistoryStore repository (TDD)

**Files:**
- Create: `src/main/history/historyStore.ts`
- Test: `tests/history/historyStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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

  it("stores a capture then attaches a summary later (note_screen fallback path)", () => {
    const s = store.startSession("m");
    const c = store.addCapture({ sessionId: s.id, turnId: null, thumbPath: "/tmp/c.webp", summary: "" });
    expect(store.search("kubernetes").length).toBe(0);
    store.setCaptureSummary(c.id, "a kubernetes cluster diagram");
    expect(store.search("kubernetes").length).toBe(1);
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/history/historyStore.test.ts`
Expected: FAIL — `HistoryStore` not found.

- [ ] **Step 3: Implement `HistoryStore`**

```ts
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

  // Attach/replace a capture's summary (produced by the note_screen tool, possibly after the row exists).
  setCaptureSummary(captureId: number, summary: string): void {
    const row = this.db.prepare("SELECT session_id as sessionId, created_at as createdAt FROM captures WHERE id=?").get(captureId) as { sessionId: number; createdAt: number } | undefined;
    if (!row) return;
    this.db.prepare("UPDATE captures SET summary=? WHERE id=?").run(summary, captureId);
    this.db.prepare("DELETE FROM search_fts WHERE kind='capture' AND ref_id=?").run(captureId);
    if (summary) {
      this.db.prepare(
        "INSERT INTO search_fts (body, kind, ref_id, session_id, created_at) VALUES (?, 'capture', ?, ?, ?)"
      ).run(summary, captureId, row.sessionId, row.createdAt);
    }
  }

  listSessions(): Session[] {
    return this.db.prepare("SELECT id, mode, model, started_at as startedAt, ended_at as endedAt, status FROM sessions ORDER BY id DESC").all() as Session[];
  }

  listTurns(sessionId: number): Turn[] {
    return this.db.prepare(
      "SELECT id, session_id as sessionId, role, source, text, created_at as createdAt FROM turns WHERE session_id=? ORDER BY id ASC"
    ).all(sessionId) as Turn[];
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/history/historyStore.test.ts`
Expected: PASS (all 7 tests). Search input is sanitized inside `search()` via `toFtsMatch`, so special characters and empty queries never throw `MATCH` syntax errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/history/historyStore.ts tests/history/historyStore.test.ts
git commit -m "feat: HistoryStore repository with FTS5 search (tested)"
```

---

## Chunk 3: API key, token minting, permissions

**Outcome:** The API key is stored encrypted; the main process mints ephemeral Realtime tokens from it; mic/screen permission status is queryable. All exposed over IPC.

### Task 3.1: KeyStore (safeStorage) — TDD-lite

**Files:**
- Create: `src/main/keyStore.ts`
- Test: `tests/main/keyStore.test.ts`

`safeStorage` requires Electron's runtime, so the unit test targets the pure round-trip logic by injecting a cipher. Design `KeyStore` to accept an injectable `crypto` port.

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/keyStore.test.ts
import { describe, it, expect } from "vitest";
import { KeyStore } from "../../src/main/keyStore";

// In-memory fake of the safeStorage + disk ports.
function fakePorts() {
  let file: Buffer | null = null;
  return {
    crypto: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from("enc:" + s),
      decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ""),
    },
    disk: {
      write: (b: Buffer) => { file = b; },
      read: () => file,
      exists: () => file !== null,
    },
  };
}

describe("KeyStore", () => {
  it("reports no key before set", () => {
    const ks = new KeyStore(fakePorts());
    expect(ks.status().hasKey).toBe(false);
  });
  it("round-trips an encrypted key", () => {
    const ks = new KeyStore(fakePorts());
    ks.set("sk-test-123");
    expect(ks.status().hasKey).toBe(true);
    expect(ks.get()).toBe("sk-test-123");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`KeyStore` not found)

Run: `npx vitest run tests/main/keyStore.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/main/keyStore.ts
import type { KeyStatus } from "@shared/types";

export interface CryptoPort {
  isEncryptionAvailable(): boolean;
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
}
export interface DiskPort { write(b: Buffer): void; read(): Buffer | null; exists(): boolean; }

export class KeyStore {
  constructor(private ports: { crypto: CryptoPort; disk: DiskPort }) {}
  status(): KeyStatus { return { hasKey: this.ports.disk.exists() }; }
  set(key: string): void {
    if (!this.ports.crypto.isEncryptionAvailable()) throw new Error("Encryption unavailable");
    this.ports.disk.write(this.ports.crypto.encryptString(key));
  }
  get(): string | null {
    const b = this.ports.disk.read();
    return b ? this.ports.crypto.decryptString(b) : null;
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/main/keyStore.test.ts`

- [ ] **Step 5: Add the real Electron adapter (not unit-tested; used in wiring)**

```ts
// append to src/main/keyStore.ts
import { safeStorage, app } from "electron";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

export function makeElectronKeyStore(): KeyStore {
  const file = join(app.getPath("userData"), "openai-key.bin");
  return new KeyStore({
    crypto: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (s) => safeStorage.encryptString(s),
      decryptString: (b) => safeStorage.decryptString(b),
    },
    disk: {
      write: (b) => writeFileSync(file, b),
      read: () => (existsSync(file) ? readFileSync(file) : null),
      exists: () => existsSync(file),
    },
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add src/main/keyStore.ts tests/main/keyStore.test.ts
git commit -m "feat: encrypted API key store (safeStorage) with injectable ports (tested)"
```

### Task 3.2: TokenMinter

**Files:**
- Create: `src/main/tokenMinter.ts`

Mints a short-lived Realtime client secret from the long-lived key. Network call — verified by manual smoke, not unit test. Confirm the exact request shape against the OpenAI docs referenced in the spec (`POST /v1/realtime/client_secrets`) at implementation time.

- [ ] **Step 1: Implement**

```ts
// src/main/tokenMinter.ts
import type { EphemeralToken } from "@shared/types";

export async function mintEphemeralToken(apiKey: string, model = "gpt-realtime-2.1"): Promise<EphemeralToken> {
  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ session: { type: "realtime", model } }),
  });
  if (!res.ok) throw new Error(`Token mint failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { value: string; expires_at: number };
  return { value: json.value, expiresAt: json.expires_at * 1000 };
}
```

- [ ] **Step 2: Verify shape (manual)** — During Chunk 6 smoke, log the minted token and confirm the WebRTC handshake accepts it. If the response schema differs, adjust the parse here.

- [ ] **Step 3: Commit**

```bash
git add src/main/tokenMinter.ts
git commit -m "feat: mint ephemeral Realtime client secret from stored key"
```

### Task 3.3: Permissions

**Files:**
- Create: `src/main/permissions.ts`

- [ ] **Step 1: Implement**

```ts
// src/main/permissions.ts
import { systemPreferences, shell } from "electron";
import type { PermissionStatus } from "@shared/types";

// getMediaAccessStatus can return granted|denied|restricted|not-determined|unknown.
// Collapse restricted/unknown -> denied for our tri-state.
function norm(s: string): PermissionStatus["microphone"] {
  if (s === "granted" || s === "denied" || s === "not-determined") return s;
  return "denied";
}

export function permissionStatus(): PermissionStatus {
  return {
    microphone: norm(systemPreferences.getMediaAccessStatus("microphone")),
    screen: norm(systemPreferences.getMediaAccessStatus("screen")),
  };
}

export async function requestMicrophone(): Promise<boolean> {
  return systemPreferences.askForMediaAccess("microphone");
}
// Screen recording cannot be requested programmatically; deep-link to System Settings.
export function openScreenRecordingSettings(): void {
  shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/permissions.ts
git commit -m "feat: mic/screen permission status + request helpers"
```

---

## Chunk 4: Screen capture (worker + WebP)

**Outcome:** Main can request a downscaled WebP data URL of the whole screen on demand. Encoding happens in a hidden Chromium renderer (no `sharp`).

### Task 4.1: Capture worker renderer

**Files:**
- Create: `src/renderer/captureWorker/index.html`, `src/renderer/captureWorker/main.ts`
- Create: `src/main/windows/captureWorker.ts`

- [ ] **Step 1: Worker HTML**

```html
<!-- src/renderer/captureWorker/index.html -->
<!doctype html><html><head><meta charset="utf-8" /></head>
<body><script type="module" src="./main.ts"></script></body></html>
```

- [ ] **Step 2: Worker logic — capture, downscale, encode WebP**

The renderer uses `navigator.mediaDevices.getDisplayMedia` (authorized in main via `setDisplayMediaRequestHandler`) to grab one frame, draws it downscaled to a canvas, and returns `canvas.toDataURL('image/webp', q)`.

```ts
// src/renderer/captureWorker/main.ts
const api = (window as any).api;

async function captureOnce(maxWidth = 1152, quality = 0.6): Promise<string> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: false });
  const track = stream.getVideoTracks()[0];
  const video = document.createElement("video");
  video.srcObject = stream;
  await video.play();
  const vw = video.videoWidth, vh = video.videoHeight;
  const scale = Math.min(1, maxWidth / vw);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  track.stop();
  return canvas.toDataURL("image/webp", quality);
}

api.on("capture:do", async (requestId: string) => {
  try {
    const dataUrl = await captureOnce();
    api.invoke("capture:result", requestId, { ok: true, dataUrl });
  } catch (e) {
    api.invoke("capture:result", requestId, { ok: false, error: String(e) });
  }
});
```

- [ ] **Step 3: Hidden worker window + display-media authorization**

```ts
// src/main/windows/captureWorker.ts
import { BrowserWindow, session, desktopCapturer } from "electron";
import { join } from "path";

export function createCaptureWorker(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1, height: 1, show: false,
    webPreferences: { preload: join(__dirname, "../preload/index.js"), offscreen: false },
  });
  // Authorize getDisplayMedia to the primary screen with no picker.
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
      cb({ video: sources[0] });
    });
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/captureWorker/index.html`);
  } else {
    win.loadFile(join(__dirname, "../renderer/captureWorker/index.html"));
  }
  return win;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/captureWorker src/main/windows/captureWorker.ts
git commit -m "feat: hidden capture worker that returns downscaled WebP frames"
```

### Task 4.2: ScreenCapturer service (main side)

**Files:**
- Create: `src/main/screenCapturer.ts`

Coordinates a request/response round-trip with the worker and persists a thumbnail to disk.

- [ ] **Step 1: Implement**

```ts
// src/main/screenCapturer.ts
import { BrowserWindow, app } from "electron";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

export class ScreenCapturer {
  private pending = new Map<string, (r: { ok: boolean; dataUrl?: string; error?: string }) => void>();
  constructor(private worker: BrowserWindow) {}

  // Called by the IPC handler for "capture:result".
  resolve(requestId: string, result: { ok: boolean; dataUrl?: string; error?: string }) {
    this.pending.get(requestId)?.(result);
    this.pending.delete(requestId);
  }

  capture(): Promise<{ dataUrl: string; thumbPath: string }> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("capture timeout")); }, 5000);
      this.pending.set(id, (r) => {
        clearTimeout(timer);
        if (!r.ok || !r.dataUrl) return reject(new Error(r.error ?? "capture failed"));
        const dir = join(app.getPath("userData"), "captures");
        mkdirSync(dir, { recursive: true });
        const thumbPath = join(dir, `${id}.webp`);
        writeFileSync(thumbPath, Buffer.from(r.dataUrl.split(",")[1], "base64"));
        resolve({ dataUrl: r.dataUrl, thumbPath });
      });
      this.worker.webContents.send("capture:do", id);
    });
  }
}
```

- [ ] **Step 2: Smoke (deferred to Chunk 6 wiring)** — capture returns a valid WebP file under `userData/captures/`. Verify by opening the file.

- [ ] **Step 3: Commit**

```bash
git add src/main/screenCapturer.ts
git commit -m "feat: ScreenCapturer round-trips worker frames and persists thumbnails"
```

---

## Chunk 5: Pure session logic (TDD)

**Outcome:** Three small, fully-tested pure modules that the Realtime integration will lean on: turn pagination, the session state machine, and Realtime-event→domain mapping. No Electron/WebRTC here — pure functions.

### Task 5.1: Turn pagination

**Files:**
- Create: `src/shared/session/pagination.ts`
- Test: `tests/session/pagination.test.ts`

- [ ] **Step 1: Failing test**

```ts
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
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/session/pagination.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/shared/session/pagination.ts
export function clampIndex(i: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(i, total - 1));
}
export interface Page<T> { item: T | null; index: number; total: number; hasPrev: boolean; hasNext: boolean; }
export function pageFor<T>(items: T[], index: number): Page<T> {
  const total = items.length;
  if (total === 0) return { item: null, index: 0, total: 0, hasPrev: false, hasNext: false };
  const i = clampIndex(index, total);
  return { item: items[i], index: i, total, hasPrev: i > 0, hasNext: i < total - 1 };
}
```

- [ ] **Step 4: Run — expect PASS**, then commit

```bash
git add src/shared/session/pagination.ts tests/session/pagination.test.ts
git commit -m "feat: pure turn pagination (tested)"
```

### Task 5.2: Session state machine

**Files:**
- Create: `src/shared/session/sessionState.ts`
- Test: `tests/session/sessionState.test.ts`

States: `idle → active ⇄ paused → ended`. Transitions: `start`, `pause`, `resume`, `stop`. Invalid transitions throw.

- [ ] **Step 1: Failing test**

```ts
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
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// src/shared/session/sessionState.ts
export type SessionStatus = "idle" | "active" | "paused" | "ended";
export type SessionAction = "start" | "pause" | "resume" | "stop";

const TABLE: Record<SessionStatus, Partial<Record<SessionAction, SessionStatus>>> = {
  idle: { start: "active" },
  active: { pause: "paused", stop: "ended" },
  paused: { resume: "active", stop: "ended" },
  ended: {},
};

export function transition(state: SessionStatus, action: SessionAction): SessionStatus {
  const next = TABLE[state][action];
  if (!next) throw new Error(`Invalid transition: ${action} from ${state}`);
  return next;
}
```

- [ ] **Step 4: Run — expect PASS**, then commit

```bash
git add src/shared/session/sessionState.ts tests/session/sessionState.test.ts
git commit -m "feat: pure session state machine (tested)"
```

### Task 5.3: Realtime event → domain mapping

**Files:**
- Create: `src/shared/session/realtimeEvents.ts`
- Test: `tests/session/realtimeEvents.test.ts`

The Realtime API emits server events; we map the ones we persist into `Turn`/tool intents. This isolates event-shape knowledge from the WebRTC glue so it's testable. (Event names per the spec's referenced docs: `response.output_audio_transcript.done` → assistant turn; `conversation.item.input_audio_transcription.completed` → user voice turn; function-call events → tool intents.)

- [ ] **Step 1: Failing test**

```ts
// tests/session/realtimeEvents.test.ts
import { describe, it, expect } from "vitest";
import { mapServerEvent } from "../../src/shared/session/realtimeEvents";

describe("mapServerEvent", () => {
  it("maps a completed user audio transcription to a user voice turn", () => {
    const out = mapServerEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "hello there" });
    expect(out).toEqual({ kind: "turn", role: "user", source: "voice", text: "hello there" });
  });
  it("maps a completed assistant transcript to an assistant turn", () => {
    const out = mapServerEvent({ type: "response.output_audio_transcript.done", transcript: "hi!" });
    expect(out).toEqual({ kind: "turn", role: "assistant", source: "voice", text: "hi!" });
  });
  it("maps a note_screen function call to a summary intent", () => {
    const out = mapServerEvent({ type: "response.function_call_arguments.done", name: "note_screen", arguments: '{"summary":"a cache diagram"}', call_id: "c1" });
    expect(out).toEqual({ kind: "note_screen", summary: "a cache diagram", callId: "c1" });
  });
  it("maps a capture_screen function call to a capture intent", () => {
    const out = mapServerEvent({ type: "response.function_call_arguments.done", name: "capture_screen", arguments: "{}", call_id: "c2" });
    expect(out).toEqual({ kind: "capture_screen", callId: "c2" });
  });
  it("ignores unrelated events", () => {
    expect(mapServerEvent({ type: "response.output_audio.delta" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// src/shared/session/realtimeEvents.ts
export type MappedEvent =
  | { kind: "turn"; role: "user" | "assistant"; source: "voice" | "typed"; text: string }
  | { kind: "note_screen"; summary: string; callId: string }
  | { kind: "capture_screen"; callId: string }
  | null;

export function mapServerEvent(ev: any): MappedEvent {
  switch (ev?.type) {
    case "conversation.item.input_audio_transcription.completed":
      return { kind: "turn", role: "user", source: "voice", text: ev.transcript ?? "" };
    case "response.output_audio_transcript.done":
      return { kind: "turn", role: "assistant", source: "voice", text: ev.transcript ?? "" };
    case "response.function_call_arguments.done": {
      const args = safeParse(ev.arguments);
      if (ev.name === "note_screen") return { kind: "note_screen", summary: args.summary ?? "", callId: ev.call_id };
      if (ev.name === "capture_screen") return { kind: "capture_screen", callId: ev.call_id };
      return null;
    }
    default:
      return null;
  }
}
function safeParse(s: string): any { try { return JSON.parse(s); } catch { return {}; } }
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/session/realtimeEvents.test.ts`
Note: exact event names/fields must be reconciled with the live API during Chunk 6 smoke; if they differ, update both the map and its test together.

- [ ] **Step 5: Commit**

```bash
git add src/shared/session/realtimeEvents.ts tests/session/realtimeEvents.test.ts
git commit -m "feat: pure Realtime-event to domain mapping (tested)"
```

---

## Chunk 6: Realtime session + live notch UI

**Outcome:** Pressing Start in the notch opens a WebRTC Realtime voice session that hears you, replies by voice, sees your screen every turn, and persists every turn/capture to SQLite. Type box, Ask now, look-again, and note_screen all work. This chunk is integration-heavy; verification is manual smoke (WebRTC/mic/audio are hardware-bound), leaning on the Chunk 5 pure logic which is already unit-tested.

### Task 6.1: IPC surface for the notch (main side)

**Files:**
- Create: `src/main/ipc.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Register handlers** wiring the services from Chunks 2–5.

```ts
// src/main/ipc.ts
import { ipcMain } from "electron";
import { IPC } from "@shared/ipcChannels";
import type { HistoryStore } from "./history/historyStore";
import type { ScreenCapturer } from "./screenCapturer";
import { makeElectronKeyStore } from "./keyStore";
import { mintEphemeralToken } from "./tokenMinter";
import { permissionStatus, requestMicrophone } from "./permissions";

export function registerIpc(deps: { history: HistoryStore; capturer: ScreenCapturer; getNotch: () => import("electron").BrowserWindow | null }) {
  const keys = makeElectronKeyStore();

  ipcMain.handle(IPC.KEY_GET_STATUS, () => keys.status());
  ipcMain.handle(IPC.KEY_SET, (_e, key: string) => { keys.set(key); return keys.status(); });
  ipcMain.handle(IPC.TOKEN_MINT, async () => {
    const k = keys.get();
    if (!k) throw new Error("No API key set");
    return mintEphemeralToken(k);
  });

  ipcMain.handle(IPC.CAPTURE_SCREEN, () => deps.capturer.capture());
  // capture worker result callback:
  ipcMain.handle("capture:result", (_e, id: string, r: any) => deps.capturer.resolve(id, r));

  ipcMain.handle(IPC.HISTORY_START_SESSION, (_e, model: string) => deps.history.startSession(model));
  ipcMain.handle(IPC.HISTORY_END_SESSION, (_e, id: number) => deps.history.endSession(id));
  ipcMain.handle(IPC.HISTORY_ADD_TURN, (_e, t) => deps.history.addTurn(t));
  ipcMain.handle(IPC.HISTORY_ADD_CAPTURE, (_e, c) => deps.history.addCapture(c));
  ipcMain.handle(IPC.HISTORY_SET_CAPTURE_SUMMARY, (_e, id: number, summary: string) => deps.history.setCaptureSummary(id, summary));
  ipcMain.handle(IPC.HISTORY_LIST_SESSIONS, () => deps.history.listSessions());
  ipcMain.handle(IPC.HISTORY_LIST_TURNS, (_e, id: number) => deps.history.listTurns(id));
  ipcMain.handle(IPC.HISTORY_SEARCH, (_e, q: string) => deps.history.search(q));

  ipcMain.handle(IPC.NOTCH_SET_FOCUSABLE, (_e, on: boolean) => { deps.getNotch()?.setFocusable(on); if (on) deps.getNotch()?.focus(); });

  ipcMain.handle(IPC.PERM_STATUS, () => permissionStatus());
  ipcMain.handle(IPC.PERM_REQUEST, () => requestMicrophone());
}
```

- [ ] **Step 2: Bootstrap services in main entry**

```ts
// src/main/index.ts (replace prior body)
import { app, BrowserWindow } from "electron";
import { join } from "path";
import { createNotchWindow } from "./windows/notchWindow";
import { createCaptureWorker } from "./windows/captureWorker";
import { createTray } from "./tray";
import { openDatabase } from "./history/db";
import { HistoryStore } from "./history/historyStore";
import { ScreenCapturer } from "./screenCapturer";
import { registerIpc } from "./ipc";

let notch: BrowserWindow | null = null;

app.whenReady().then(() => {
  const db = openDatabase(join(app.getPath("userData"), "see-and-talk.db"));
  const history = new HistoryStore(db);
  const worker = createCaptureWorker();
  const capturer = new ScreenCapturer(worker);
  notch = createNotchWindow();
  registerIpc({ history, capturer, getNotch: () => notch });

  createTray({ openDashboard: () => {}, openSettings: () => {} }); // wired in Chunk 7
});

app.on("window-all-closed", () => {});
```

- [ ] **Step 3: Smoke** — `npm run dev` still launches; from the notch devtools console, `await window.api.invoke("perm:status")` returns a status object; `await window.api.invoke("key:status")` returns `{hasKey:false}`.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc.ts src/main/index.ts
git commit -m "feat: main IPC surface wiring history, capture, key, token, permissions"
```

### Task 6.2: Realtime WebRTC client (notch renderer)

**Files:**
- Create: `src/renderer/notch/realtime.ts`

Use `@openai/agents-realtime` (`RealtimeSession` + WebRTC transport). Configure `semantic_vad`, register the two tools, and forward server events to the persistence + UI layer. The exact SDK method names (`sendMessage`, `mute`, `transport.sendEvent`, tool registration) and Realtime event field names must be confirmed against the installed SDK version — but every unknown is isolated behind the already-tested `mapServerEvent` mapper and the `HistoryStore` IPC, so the buildable core does not change if names differ. All capture calls are guarded so a capture failure degrades to audio-only (never an unhandled rejection). The current DB session id is held in a **mutable** `let` so Chunk 8's reconnect can repoint it.

- [ ] **Step 1: Define the two tool schemas**

```ts
// tool schemas passed to RealtimeAgent.tools (adjust wrapper to the SDK's tool() helper if provided)
const noteScreenTool = {
  type: "function",
  name: "note_screen",
  description: "Record a one-to-two sentence summary of what the user's screen currently shows. Call this whenever you are given a new screenshot.",
  parameters: {
    type: "object",
    properties: { summary: { type: "string", description: "Brief description of the visible screen." } },
    required: ["summary"],
  },
};
const captureScreenTool = {
  type: "function",
  name: "capture_screen",
  description: "Request a fresh screenshot of the user's screen when you need an updated look before answering.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
};
```

- [ ] **Step 2: Realtime session wrapper (guarded capture, capture-row + summary, pause/resume, mutable session id)**

```ts
// src/renderer/notch/realtime.ts
import { RealtimeSession, RealtimeAgent } from "@openai/agents-realtime";
import { mapServerEvent } from "@shared/session/realtimeEvents";
const api = (window as any).api;

export interface ConverseHooks {
  onAssistantText(text: string): void;
  onUserText(text: string): void;
  onStatus(s: string): void;       // "connected" | "reconnecting" | "capture-failed" | ...
}

export async function startConverse(hooks: ConverseHooks) {
  const token = await api.invoke("token:mint");
  let currentSessionId: number = (await api.invoke("history:startSession", "gpt-realtime-2.1")).id;
  let lastCaptureId: number | null = null;

  const agent = new RealtimeAgent({
    name: "See-and-Talk",
    instructions:
      "You are a Socratic study companion who can see the user's screen. Whenever you are given a " +
      "new screenshot, call note_screen(summary) with a one-to-two sentence description of what it " +
      "shows. Call capture_screen when you need a fresh look before answering. Keep replies concise.",
    tools: [noteScreenTool, captureScreenTool],
  });

  const session = new RealtimeSession(agent, {
    transport: "webrtc",
    model: "gpt-realtime-2.1",
    config: { audio: { input: { turnDetection: { type: "semantic_vad" } }, output: { voice: "marin" } } },
  });

  // Capture the screen, persist a captures row immediately (empty summary = fallback), inject the image.
  // Returns without throwing on failure; signals the UI instead.
  async function captureAndInject(): Promise<void> {
    try {
      const shot = await api.invoke("capture:screen"); // { dataUrl, thumbPath }
      const cap = await api.invoke("history:addCapture", { sessionId: currentSessionId, turnId: null, thumbPath: shot.thumbPath, summary: "" });
      lastCaptureId = cap.id;
      injectImage(session, shot.dataUrl);
    } catch (e) {
      hooks.onStatus("capture-failed"); // proceed audio-only for this turn
    }
  }

  session.on("transport_event", (ev: any) => { void handleServerEvent(ev); });

  async function handleServerEvent(ev: any) {
    try {
      // Race mitigation: capture when the user STARTS speaking, so the image is already in
      // context by the time semantic_vad auto-creates the response after they stop.
      if (ev?.type === "input_audio_buffer.speech_started") { await captureAndInject(); return; }

      const mapped = mapServerEvent(ev);
      if (!mapped) return;
      if (mapped.kind === "turn") {
        await api.invoke("history:addTurn", { sessionId: currentSessionId, role: mapped.role, source: mapped.source, text: mapped.text });
        mapped.role === "assistant" ? hooks.onAssistantText(mapped.text) : hooks.onUserText(mapped.text);
      } else if (mapped.kind === "note_screen") {
        if (lastCaptureId != null) await api.invoke("history:setCaptureSummary", lastCaptureId, mapped.summary);
        else await api.invoke("history:addCapture", { sessionId: currentSessionId, turnId: null, thumbPath: "", summary: mapped.summary });
      } else if (mapped.kind === "capture_screen") {
        await captureAndInject();
        session.transport.sendEvent({ type: "response.create" }); // answer using the fresh frame
      }
    } catch { /* never let a handler rejection go unhandled */ }
  }

  await session.connect({ apiKey: token.value });
  hooks.onStatus("connected");

  return {
    getSessionId: () => currentSessionId,
    setSessionId: (id: number) => { currentSessionId = id; }, // used by reconnect (Chunk 8)
    async sendText(text: string) {
      await api.invoke("history:addTurn", { sessionId: currentSessionId, role: "user", source: "typed", text });
      await captureAndInject();
      session.sendMessage(text);
    },
    async askNow() {
      await captureAndInject();
      session.sendMessage("Please respond about what you currently see on my screen.");
    },
    mute(on: boolean) { session.mute(on); },
    pause() { session.mute(true); },          // pause == mute the mic; kept distinct for the Pause control + state machine
    resume() { session.mute(false); },
    async stop() { await session.close(); await api.invoke("history:endSession", currentSessionId); },
    _session: session, _setLastCaptureNull: () => { lastCaptureId = null; },
  };
}

function injectImage(session: any, dataUrl: string) {
  session.transport.sendEvent({
    type: "conversation.item.create",
    item: { type: "message", role: "user", content: [{ type: "input_image", image_url: dataUrl }] },
  });
}
```

Key points this closes from review:
- **Every capture writes a `captures` row** (empty-summary fallback); `note_screen` then fills it via `setCaptureSummary` — no orphaned thumbnails, capture always persisted/searchable.
- **Capture failures are caught** → audio-only turn + `capture-failed` status, never an unhandled rejection.
- **Per-turn vision wins the race**: captured on `speech_started`, before `semantic_vad` creates the response.
- **`currentSessionId` is mutable** so reconnect (Chunk 8) can repoint it.
- **`transport_event` handler body is wrapped** so no rejection escapes.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/notch/realtime.ts
git commit -m "feat: WebRTC Realtime converse session — guarded per-turn capture, tools, pause/resume"
```

### Task 6.3: Notch live UI (controls, pagination, type box)

**Files:**
- Modify: `src/renderer/notch/main.ts`, `src/renderer/notch/index.html`, `src/renderer/notch/styles.css`
- Create: `src/renderer/notch/ui.ts`

- [ ] **Step 1: Build the UI** — render current turn (paginated via the tested `pageFor`), Start/Pause/Stop, Mute, Ask now, type box, Prev/Next, and a "dashboard" link. Collapsed (idle) vs expanded (has content) states per the approved mock. Use `-webkit-app-region: drag` on the panel background and `no-drag` on interactive controls. The notch is a small window (not full-screen), so desktop interaction elsewhere is unaffected.

```ts
// src/renderer/notch/ui.ts (skeleton)
import { pageFor } from "@shared/session/pagination";
import type { Turn } from "@shared/types";

export function renderNotch(root: HTMLElement, state: { turns: Turn[]; index: number; status: string }, actions: {
  start(): void; pause(): void; stop(): void; mute(on: boolean): void; askNow(): void;
  sendText(t: string): void; prev(): void; next(): void; openDashboard(): void;
}) {
  const page = pageFor(state.turns, state.index);
  // ... build DOM: answer text = page.item?.text, disable Prev if !page.hasPrev, disable Next if !page.hasNext, etc.
}
```

- [ ] **Step 2: Drive controls through the tested state machine** — hold `status: SessionStatus` in `main.ts` and route Start/Pause/Stop/resume through `transition()` from `@shared/session/sessionState`; reject invalid presses (e.g. Pause while idle) using its thrown error to keep buttons consistent. Map states to session-wrapper calls: `start`→`startConverse`, `pause`→`converse.pause()`, `resume`→`converse.resume()`, `stop`→`converse.stop()`. Assistant/user text hooks push a turn into local state and re-render at the newest index.

- [ ] **Step 3: Type-box focus handling** — the notch window is `focusable:false`, so on the type box `focus` event call `api.invoke("notch:setFocusable", true)` and on `blur` call `api.invoke("notch:setFocusable", false)`. This lets you type without the window stealing focus while merely listening. Enter submits (`sendText`), which also triggers a capture.

- [ ] **Step 4: Smoke — the core end-to-end** (requires API key set via devtools `await window.api.invoke("key:set","sk-...")` until Settings exists, plus mic + screen-recording permission granted in System Settings):
  - Click Start → status "connected"; speak → your transcript appears as a user turn and the AI replies **by voice** and as an assistant turn.
  - Draw/change something on screen, ask about it → the reply reflects the current screen (per-turn capture working).
  - Click **Ask now** with no speech → AI comments on the current screen.
  - Type in the box → AI responds (type box gains focus via the `notch:setFocusable` toggle).
  - **Prev/Next** page through turns; notch stays small.
  - **Pause** stops it hearing you and the session stays warm; resume continues without a reconnect. **Mute** silences the mic; **Stop** ends the session.
  - Confirm rows exist: `await window.api.invoke("history:listTurns", <id>)`, a `captures` row per capture (empty summary until `note_screen` fills it), and files under `userData/captures/`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/notch
git commit -m "feat: live notch UI — paginated turns, state-machine controls, type box, Ask now"
```

---

## Chunk 7: Dashboard, settings/onboarding, tray & shortcuts

**Outcome:** A dashboard to browse/search history, a settings/onboarding window to set the key and see permissions, working tray actions, and global shortcuts.

### Task 7.1: Dashboard window + renderer

**Files:**
- Create: `src/main/windows/dashboardWindow.ts`, `src/renderer/dashboard/{index.html,main.ts,styles.css}`

- [ ] **Step 1: Window factory** — normal resizable `BrowserWindow` loading `dashboard/index.html`; created lazily, focused if already open.

- [ ] **Step 2: Renderer** — a search box + results list. On input (debounced, skipping empty/whitespace), call `history:search`; render snippets grouped by session. Clicking a session lists its turns via `history:listTurns`. FTS input sanitization already lives in the tested `HistoryStore.search()` (`toFtsMatch`), so the renderer passes raw text — no per-caller escaping needed.

- [ ] **Step 3: Smoke** — after a Converse session exists, open Dashboard from tray, search a word you said, see a hit, click through to the transcript.

- [ ] **Step 4: Commit**

```bash
git add src/main/windows/dashboardWindow.ts src/renderer/dashboard
git commit -m "feat: history dashboard with FTS5 search"
```

### Task 7.2: Settings / onboarding window

**Files:**
- Create: `src/main/windows/settingsWindow.ts`, `src/renderer/settings/{index.html,main.ts,styles.css}`

- [ ] **Step 1: Window factory** — normal window loading `settings/index.html`.

- [ ] **Step 2: Renderer** — API key input (`key:set`) with a "key is set" indicator (`key:status`); permission status (`perm:status`) with a "Request microphone" button (`perm:request`) and an "Open Screen Recording settings" button; a shortcut display (edit deferred — show defaults). On first run with no key, the notch shows a "Set up in Settings" prompt and Start is disabled until `key:status.hasKey`.

- [ ] **Step 3: Smoke** — set the key here (not devtools), grant mic, confirm notch Start becomes enabled.

- [ ] **Step 4: Commit**

```bash
git add src/main/windows/settingsWindow.ts src/renderer/settings
git commit -m "feat: settings/onboarding — API key, permissions"
```

### Task 7.3: Tray wiring + global shortcuts

**Files:**
- Create: `src/main/shortcuts.ts`
- Modify: `src/main/index.ts`, `src/main/tray.ts`

- [ ] **Step 1: Shortcuts** — register `globalShortcut` for Ask now, toggle mute/listen (renderer-targeted, since the session lives there) and show/hide notch (main-targeted, since showing/hiding an OS window — and re-showing a `focusable:false` one — is a main-process job). Defaults: `Cmd+Shift+A` (Ask now), `Cmd+Shift+M` (mute), `Cmd+Shift+H` (show/hide). Unregister all on `will-quit`.

```ts
// src/main/shortcuts.ts
import { globalShortcut, BrowserWindow } from "electron";

export function registerShortcuts(deps: { sendToNotch: (channel: string) => void; toggleNotch: () => void }) {
  globalShortcut.register("CommandOrControl+Shift+A", () => deps.sendToNotch("hotkey:askNow"));
  globalShortcut.register("CommandOrControl+Shift+M", () => deps.sendToNotch("hotkey:toggleMute"));
  globalShortcut.register("CommandOrControl+Shift+H", () => deps.toggleNotch()); // main handles show/hide
}
export function unregisterShortcuts() { globalShortcut.unregisterAll(); }
```

Main provides `toggleNotch`: `if (notch.isVisible()) notch.hide(); else notch.show();`.

- [ ] **Step 2: Wire tray + shortcuts** — connect tray `openDashboard`/`openSettings` to the window factories (tray icon already resolved in Task 1.4); register shortcuts in `app.whenReady` passing `sendToNotch` (via `notch.webContents.send`) and `toggleNotch`; call `unregisterShortcuts()` on `will-quit`. Handle `hotkey:askNow`/`hotkey:toggleMute` in the notch renderer.

- [ ] **Step 3: Smoke** — tray opens both windows; each shortcut triggers its action while another app is focused.

- [ ] **Step 4: Commit**

```bash
git add src/main/shortcuts.ts src/main/index.ts src/main/tray.ts src/renderer/notch
git commit -m "feat: tray actions and global shortcuts (ask now, mute, show/hide)"
```

---

## Chunk 8: Reconnect, error handling, and end-to-end verification

**Outcome:** Long sessions survive the 60-minute cap and network drops without losing history; failures surface gracefully; a documented full smoke pass.

### Task 8.1: Reconnect on cap/drop

**Files:**
- Modify: `src/renderer/notch/realtime.ts`

- [ ] **Step 1: Detect end/drop** — listen for the session close/error event. On a close that isn't a user-initiated Stop, reconnect transparently **under the same DB session row**: the 60-min limit is on the Realtime *connection*, not our history. Mint a fresh token, open a new `RealtimeSession`, and seed it by reading recent turns of the current session (`history:listTurns(currentSessionId)`, last N) and adding them as prior context items. Do **not** create a new `sessions` row and do **not** call `setSessionId` — keep `currentSessionId` unchanged so all turns (before and after) stay in one session, and the Dashboard shows a single continuous conversation. (`setSessionId` exists only as a hook for future modes; v1 reconnect leaves it untouched.) Guard against reconnect storms with a short backoff and a "user pressed Stop" flag so Stop doesn't trigger a reconnect.
- [ ] **Step 2: Surface state** — show a subtle "reconnecting…" status in the notch (via `onStatus`); return to "connected" after reseed.
- [ ] **Step 3: Smoke (abbreviated)** — force `session.close()` from devtools (not via Stop); confirm auto-reconnect, that new turns keep persisting to the **same** session id, and that the Dashboard lists exactly one session spanning both halves. Confirm no unhandled rejection.
- [ ] **Step 4: Commit**

```bash
git add src/renderer/notch/realtime.ts
git commit -m "feat: auto-reconnect on cap/drop under the same session (history-seeded)"
```

### Task 8.2: Error surfaces

**Files:**
- Modify: `src/renderer/notch/main.ts`, `src/main/ipc.ts`

- [ ] **Step 1:** No API key → Start disabled + "Set up in Settings". Token-mint failure → notch shows an error with a Retry. Capture failure → the turn proceeds audio-only: the guard already lives in `captureAndInject` (Task 6.2), which emits the `capture-failed` status — here, render that status as a transient badge and continue. Missing screen-recording → notch badge "screen not shared — enable in Settings"; conversation still works voice-only.
- [ ] **Step 2: Smoke** — remove the key file and launch: onboarding path. Provide a bad key: mint failure surfaces with Retry. Deny screen recording: voice still works, badge shown.
- [ ] **Step 3: Commit**

```bash
git add src/renderer/notch src/main/ipc.ts
git commit -m "feat: graceful error surfaces for key/token/capture/permission failures"
```

### Task 8.3: Full manual smoke checklist + typecheck/test gate

- [ ] **Step 1: Run the gate**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all Vitest suites pass (historyStore, pagination, sessionState, realtimeEvents, keyStore).

- [ ] **Step 2: Full smoke pass** (fresh `userData`):
  1. First launch → onboarding; set key in Settings; grant mic; enable screen recording.
  2. Start → speak a system-design question while drawing on a canvas → AI replies by voice and references what you drew.
  3. Change the drawing, ask a follow-up → reply reflects the change (per-turn capture).
  4. Ask now (button, then shortcut) → screen-based reply, no words.
  5. Type a message → reply.
  6. Prev/Next page through turns; drag + resize the notch.
  7. Mute → it stops hearing you; unmute → resumes.
  8. Open Dashboard → search a spoken word → hit → open transcript.
  9. Stop → session finalized; reopen Dashboard → session listed with all turns and captures.
  10. Leave a session running past a forced reconnect → history intact, conversation continues under one session.

- [ ] **Step 3: Commit any fixes found during smoke**

```bash
git commit -am "fix: issues found during full smoke pass"
```

---

## Known v1 deviations from spec (intentional)

- **Shortcut editing deferred.** Spec §6/§4.2 says shortcuts are "configurable in settings"; v1 ships fixed defaults and displays them (no editor). Editing is a small follow-up, not a v1 blocker.

## Done criteria

- `npm run typecheck && npm test` green (suites: historyStore, pagination, sessionState, realtimeEvents, keyStore).
- The full smoke checklist (Task 8.3) passes on a clean profile.
- Every user/assistant turn and every capture is persisted (empty-summary fallback) and searchable; `note_screen` summaries attach to their capture row.
- The notch is a small, draggable, resizable panel that never blocks desktop interaction; the type box accepts input via the focusable toggle.
- No API key, bad key, denied permission, capture failure, and mid-session reconnect all degrade gracefully; reconnect keeps a single continuous session.
