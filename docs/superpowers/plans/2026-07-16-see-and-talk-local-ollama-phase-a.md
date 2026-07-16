# See-and-Talk Local (Ollama) — Phase A Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the OpenAI Realtime brain with a local Ollama (`gemma4:26b`) turn-based request/response pipeline, keeping the existing notch UI, SQLite history, Dashboard, and screen capture. Ships a working local app.

**Architecture:** A Send in the notch captures the screen and sends `{text + WebP image}` to Ollama's OpenAI-compatible `/v1/chat/completions` via a main-process `ollama:chat` IPC handler. A `ConfigStore` holds the Ollama URL + model (editable in Settings). OpenAI/WebRTC/token-minting/mic code is removed. UI polish (Cody-style notch) is deferred to Phase B.

**Tech Stack:** Electron, TypeScript, better-sqlite3 (unchanged), Vitest. External runtime: Ollama, Handy (both user-run).

**Spec:** `docs/superpowers/specs/2026-07-16-see-and-talk-local-ollama-design.md`

---

## File Structure

**New (main process):**
- `src/main/config/configStore.ts` — `{ ollamaUrl, model }` JSON in `userData`, defaults + fallback.
- `src/main/ollama/ollamaClient.ts` — pure `ollamaChat(fetchImpl, cfg, messages)` → text.
- `tests/main/configStore.test.ts`, `tests/main/ollamaClient.test.ts`.

**Modified:**
- `src/shared/ipcChannels.ts` — drop key/token/setCaptureSummary/keyChanged/toggleMute; add config + ollama.
- `src/shared/types.ts` — drop `EphemeralToken`, `KeyStatus`; drop `microphone` from `PermissionStatus`; add `ConfigData`.
- `src/main/ipc.ts` — strip key/token/setCaptureSummary handlers; add config + ollama handlers.
- `src/main/permissions.ts` — screen-only.
- `src/main/shortcuts.ts` — drop toggle-mute; keep ask-now + toggle-notch.
- `src/renderer/notch/realtime.ts` → rewrite as local `startConverse` (turn-based, no WebRTC).
- `src/renderer/notch/main.ts` — turn-based controller (drop start/pause/stop/mute session model).
- `src/renderer/notch/ui.ts` — text field + Send + response + pagination; drop session controls + hasKey gate.
- `src/renderer/settings/index.html` + `main.ts` — Ollama URL + model instead of API key.
- `package.json` — remove `@openai/agents-realtime`.

**Deleted:**
- `src/main/tokenMinter.ts`, `src/main/keyStore.ts`, `tests/main/keyStore.test.ts`.
- `src/shared/session/realtimeEvents.ts`, `tests/session/realtimeEvents.test.ts`.
- `src/shared/session/sessionState.ts`, `tests/session/sessionState.test.ts`.

---

## Chunk 1: Main-process units (ConfigStore + OllamaClient)

### Task 1: ConfigStore

**Files:**
- Create: `src/main/config/configStore.ts`
- Test: `tests/main/configStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/configStore.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/configStore.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/config/configStore.ts
export interface ConfigData { ollamaUrl: string; model: string; }
export const DEFAULT_CONFIG: ConfigData = { ollamaUrl: "http://localhost:11434", model: "gemma4:26b" };

export interface ConfigDisk { read(): string | null; write(s: string): void; }

export class ConfigStore {
  constructor(private disk: ConfigDisk) {}
  get(): ConfigData {
    const raw = this.disk.read();
    if (!raw) return { ...DEFAULT_CONFIG };
    try {
      const parsed = JSON.parse(raw) as Partial<ConfigData>;
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }
  set(partial: Partial<ConfigData>): ConfigData {
    const next = { ...this.get(), ...partial };
    this.disk.write(JSON.stringify(next));
    return next;
  }
}

import { app } from "electron";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

export function makeElectronConfigStore(): ConfigStore {
  const file = join(app.getPath("userData"), "config.json");
  return new ConfigStore({
    read: () => (existsSync(file) ? readFileSync(file, "utf8") : null),
    write: (s) => writeFileSync(file, s),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/configStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/config/configStore.ts tests/main/configStore.test.ts
git commit -m "feat: ConfigStore for Ollama url + model with default/malformed fallback"
```

### Task 2: OllamaClient

**Files:**
- Create: `src/main/ollama/ollamaClient.ts`
- Test: `tests/main/ollamaClient.test.ts`

Notes: `fetch` is injected as a port so the test needs no network. The client builds an OpenAI-compatible body; a message with an image becomes a `content` array (`text` + `image_url`), otherwise a plain string.

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/ollamaClient.test.ts
import { describe, it, expect } from "vitest";
import { ollamaChat, type ChatMessage } from "../../src/main/ollama/ollamaClient";

const cfg = { ollamaUrl: "http://localhost:11434", model: "gemma4:26b" };

function okFetch(captured: { body?: any; url?: string }) {
  return (async (url: string, init: any) => {
    captured.url = url;
    captured.body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: "hi there" } }] }) };
  }) as unknown as typeof fetch;
}

describe("ollamaChat", () => {
  it("posts to the OpenAI-compatible endpoint and returns the assistant text", async () => {
    const cap: { body?: any; url?: string } = {};
    const msgs: ChatMessage[] = [{ role: "user", text: "what is this?" }];
    const out = await ollamaChat(okFetch(cap), cfg, msgs);
    expect(out).toBe("hi there");
    expect(cap.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(cap.body.model).toBe("gemma4:26b");
    expect(cap.body.messages[0]).toEqual({ role: "user", content: "what is this?" });
  });

  it("encodes an image message as an OpenAI content array", async () => {
    const cap: { body?: any } = {};
    const msgs: ChatMessage[] = [{ role: "user", text: "read this", imageDataUrl: "data:image/webp;base64,AAA" }];
    await ollamaChat(okFetch(cap), cfg, msgs);
    expect(cap.body.messages[0].content).toEqual([
      { type: "text", text: "read this" },
      { type: "image_url", image_url: { url: "data:image/webp;base64,AAA" } },
    ]);
  });

  it("maps a connection failure to a clear error", async () => {
    const boom = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    await expect(ollamaChat(boom, cfg, [{ role: "user", text: "x" }]))
      .rejects.toThrow(/Ollama not reachable at http:\/\/localhost:11434/);
  });

  it("throws on a non-ok HTTP response with the status", async () => {
    const bad = (async () => ({ ok: false, status: 404, text: async () => "model not found" })) as unknown as typeof fetch;
    await expect(ollamaChat(bad, cfg, [{ role: "user", text: "x" }]))
      .rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/ollamaClient.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/ollama/ollamaClient.ts
// OllamaConfig is intentionally a local 2-field shape (not imported from @shared/types)
// so this task is self-contained — ConfigData is added later in Task 3.
export interface OllamaConfig { ollamaUrl: string; model: string; }
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  text: string;
  imageDataUrl?: string; // only meaningful on user messages
}

function toContent(m: ChatMessage) {
  if (!m.imageDataUrl) return m.text;
  return [
    { type: "text", text: m.text },
    { type: "image_url", image_url: { url: m.imageDataUrl } },
  ];
}

export async function ollamaChat(
  fetchImpl: typeof fetch,
  cfg: OllamaConfig,
  messages: ChatMessage[],
): Promise<string> {
  const url = `${cfg.ollamaUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const body = {
    model: cfg.model,
    stream: false,
    messages: messages.map((m) => ({ role: m.role, content: toContent(m) })),
  };
  let res: any;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`Ollama not reachable at ${cfg.ollamaUrl} — is it running? (${String(e)})`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama request failed: ${res.status} ${detail}`);
  }
  const json = await res.json();
  return json?.choices?.[0]?.message?.content ?? "";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/ollamaClient.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/ollama/ollamaClient.ts tests/main/ollamaClient.test.ts
git commit -m "feat: OllamaClient (OpenAI-compatible chat + vision) with injectable fetch"
```

---

## Chunk 2: IPC rewiring + removals

### Task 3: Update shared channels and types

**Files:**
- Modify: `src/shared/ipcChannels.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Edit `ipcChannels.ts`** — remove `KEY_GET_STATUS`, `KEY_SET`, `TOKEN_MINT`, `HISTORY_SET_CAPTURE_SUMMARY`; add `CONFIG_GET`, `CONFIG_SET`, `OLLAMA_CHAT`. In `IPC_EVENT` remove `KEY_CHANGED` and `HOTKEY_TOGGLE_MUTE` (keep `HOTKEY_ASK_NOW`).

```ts
// src/shared/ipcChannels.ts
export const IPC = {
  // history
  HISTORY_START_SESSION: "history:startSession",
  HISTORY_END_SESSION: "history:endSession",
  HISTORY_ADD_TURN: "history:addTurn",
  HISTORY_ADD_CAPTURE: "history:addCapture",
  HISTORY_LIST_SESSIONS: "history:listSessions",
  HISTORY_LIST_TURNS: "history:listTurns",
  HISTORY_LIST_CAPTURES: "history:listCaptures",
  HISTORY_SEARCH: "history:search",
  // config + brain
  CONFIG_GET: "config:get",
  CONFIG_SET: "config:set",
  OLLAMA_CHAT: "ollama:chat",
  // capture
  CAPTURE_SCREEN: "capture:screen",
  CAPTURE_THUMB: "capture:thumb",
  CAPTURE_OPEN: "capture:open",
  CAPTURE_REVEAL: "capture:reveal",
  // notch window control
  NOTCH_SET_FOCUSABLE: "notch:setFocusable",
  // permissions
  PERM_STATUS: "perm:status",
  PERM_OPEN_SCREEN_SETTINGS: "perm:openScreenSettings",
} as const;

export const IPC_EVENT = {
  HOTKEY_ASK_NOW: "hotkey:askNow",
} as const;
```

Note: `PERM_REQUEST` (mic) removed. `NOTCH_SET_FOCUSABLE` kept.

- [ ] **Step 2: Edit `types.ts`** — drop `EphemeralToken` and `KeyStatus`; drop `microphone` from `PermissionStatus`; add `ConfigData`.

```ts
// replace the last three lines of src/shared/types.ts
export interface ConfigData { ollamaUrl: string; model: string; }
export interface PermissionStatus { screen: "granted" | "denied" | "not-determined"; }
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/ipcChannels.ts src/shared/types.ts
git commit -m "refactor: swap key/token/mic channels+types for config+ollama"
```

### Task 4: Rewire `main/ipc.ts`

**Files:**
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: Replace the auth/config + capture-summary section.** Remove `makeElectronKeyStore`, `mintEphemeralToken`, `requestMicrophone` imports and their handlers (`KEY_GET_STATUS`, `KEY_SET`, `TOKEN_MINT`, `HISTORY_SET_CAPTURE_SUMMARY`, `PERM_REQUEST`). Add config + ollama.

New imports at top:
```ts
import { makeElectronConfigStore } from "./config/configStore";
import { ollamaChat, type ChatMessage } from "./ollama/ollamaClient";
```

Replace the KeyStore block with:
```ts
  const config = makeElectronConfigStore();

  ipcMain.handle(IPC.CONFIG_GET, () => config.get());
  ipcMain.handle(IPC.CONFIG_SET, (_e, partial) => config.set(partial));
  ipcMain.handle(IPC.OLLAMA_CHAT, (_e, messages: ChatMessage[]) =>
    ollamaChat(fetch, config.get(), messages),
  );
```

Remove the `IPC.TOKEN_MINT`, `IPC.KEY_*`, `IPC.HISTORY_SET_CAPTURE_SUMMARY`, and `IPC.PERM_REQUEST` handlers. Keep `PERM_STATUS` and `PERM_OPEN_SCREEN_SETTINGS`.

- [ ] **Step 2: Update `permissions.ts` import usage** — remove `requestMicrophone` from the import list (only `permissionStatus`, `openScreenRecordingSettings` remain).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in files still referencing removed symbols (fixed in later tasks). Note them; proceed.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat: config:get/set + ollama:chat IPC; drop key/token/mic/setCaptureSummary"
```

### Task 5: Trim permissions, shortcuts, HistoryStore; delete OpenAI files

**Files:**
- Modify: `src/main/permissions.ts`, `src/main/shortcuts.ts`, `src/main/history/historyStore.ts`
- Delete: `src/main/tokenMinter.ts`, `src/main/keyStore.ts`, `tests/main/keyStore.test.ts`, `src/shared/session/realtimeEvents.ts`, `tests/session/realtimeEvents.test.ts`, `src/shared/session/sessionState.ts`, `tests/session/sessionState.test.ts`

- [ ] **Step 1: `permissions.ts`** — screen-only:

```ts
// src/main/permissions.ts
import { systemPreferences, shell } from "electron";
import type { PermissionStatus } from "@shared/types";

function norm(s: string): PermissionStatus["screen"] {
  if (s === "granted" || s === "denied" || s === "not-determined") return s;
  return "denied";
}
export function permissionStatus(): PermissionStatus {
  return { screen: norm(systemPreferences.getMediaAccessStatus("screen")) };
}
export function openScreenRecordingSettings(): void {
  shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
}
```

- [ ] **Step 2: `shortcuts.ts`** — drop toggle-mute (M):

```ts
// src/main/shortcuts.ts
import { globalShortcut } from "electron";
import { IPC_EVENT } from "@shared/ipcChannels";

export function registerShortcuts(deps: {
  sendToNotch: (channel: string) => void;
  toggleNotch: () => void;
}): void {
  globalShortcut.register("CommandOrControl+Shift+A", () => deps.sendToNotch(IPC_EVENT.HOTKEY_ASK_NOW));
  globalShortcut.register("CommandOrControl+Shift+H", () => deps.toggleNotch());
}
export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}
```

- [ ] **Step 3: `historyStore.ts`** — delete the `setCaptureSummary` method (lines 46-57).

- [ ] **Step 4: Delete dead files**

```bash
git rm src/main/tokenMinter.ts src/main/keyStore.ts tests/main/keyStore.test.ts \
  src/shared/session/realtimeEvents.ts tests/session/realtimeEvents.test.ts \
  src/shared/session/sessionState.ts tests/session/sessionState.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove OpenAI/keyStore/mic/sessionState/realtimeEvents dead code"
```

---

## Chunk 3: Renderer (notch + settings), cleanup, build

### Task 6: Rewrite notch `realtime.ts` as a local turn pipeline

**Files:**
- Rewrite: `src/renderer/notch/realtime.ts`

Keeps the exported name `startConverse` / type `Converse` so `main.ts` changes stay small. No WebRTC, no session state — one method `ask(text)` that persists the user turn + capture (summary = the question text, inline), calls `ollama:chat`, persists + returns the assistant turn.

> **Note on spec §8 "capture→summary" test:** that behavior (`addCapture({ summary: q })`) lives inside `ask()`, which depends on the `window.api` global — not unit-test-friendly without a renderer harness, and the notch is rewritten in Phase B. In Phase A it is verified by **manual smoke step 7** (Dashboard FTS search finds the question text on the capture). Deferring the unit test here, not skipping the verification.

- [ ] **Step 1: Replace the file**

```ts
// src/renderer/notch/realtime.ts
// Local turn pipeline: capture screen + send text to Ollama, return assistant text.
// No WebRTC, no live session — one request per Send.
const api = (window as any).api;

const CONTEXT_TURNS = 10; // resend last N turns (text only) for continuity

export interface ConverseHooks {
  onUserText(text: string): void;
  onAssistantText(text: string): void;
  onStatus(s: string): void; // "thinking…" | "" | "error: …"
}

export async function startConverse(hooks: ConverseHooks) {
  const cfg = await api.invoke("config:get"); // { ollamaUrl, model }
  const sessionId: number = (await api.invoke("history:startSession", cfg.model)).id;
  const context: Array<{ role: "user" | "assistant"; text: string }> = [];

  async function ask(text: string): Promise<void> {
    const q = text.trim();
    if (!q) return;
    hooks.onUserText(q);
    await api.invoke("history:addTurn", { sessionId, role: "user", source: "typed", text: q });

    // Auto-capture; summary = the question text (inline), best-effort.
    let imageDataUrl: string | undefined;
    try {
      const shot = await api.invoke("capture:screen"); // { dataUrl, thumbPath }
      await api.invoke("history:addCapture", { sessionId, turnId: null, thumbPath: shot.thumbPath, summary: q });
      imageDataUrl = shot.dataUrl;
    } catch {
      hooks.onStatus("capture-failed"); // proceed text-only
    }

    context.push({ role: "user", text: q });
    const recent = context.slice(-CONTEXT_TURNS);
    // Only the current turn carries the image; prior turns go as text.
    const messages = recent.map((m, i) =>
      i === recent.length - 1 && imageDataUrl
        ? { role: m.role, text: m.text, imageDataUrl }
        : { role: m.role, text: m.text },
    );

    try {
      hooks.onStatus("thinking…");
      const reply: string = await api.invoke("ollama:chat", messages);
      await api.invoke("history:addTurn", { sessionId, role: "assistant", source: "typed", text: reply });
      context.push({ role: "assistant", text: reply });
      hooks.onAssistantText(reply);
      hooks.onStatus("");
    } catch (e) {
      hooks.onStatus(`error: ${String(e)}`);
    }
  }

  return {
    getSessionId: () => sessionId,
    ask,
    async askNow() { await ask("Describe what is currently on my screen."); },
    async stop() { await api.invoke("history:endSession", sessionId); },
  };
}

export type Converse = Awaited<ReturnType<typeof startConverse>>;
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/notch/realtime.ts
git commit -m "feat: local Ollama turn pipeline in notch (replaces WebRTC realtime)"
```

### Task 7: Simplify notch `ui.ts` (text field + Send + response + pagination)

**Files:**
- Rewrite: `src/renderer/notch/ui.ts`

Drop the session controls (start/pause/stop/mute) and the `hasKey` gate. Keep the turn display + prev/next pagination (uses the existing `pageFor`). Add a Send button next to the input.

- [ ] **Step 1: Replace the file**

```ts
// src/renderer/notch/ui.ts
import { pageFor } from "@shared/session/pagination";
import type { Turn } from "@shared/types";

export interface NotchState {
  turns: Turn[];
  index: number;
  statusLabel: string; // "thinking…" | "" | "error: …" | "capture failed…"
}
export interface NotchActions {
  send(text: string): void;
  askNow(): void;
  prev(): void;
  next(): void;
  openDashboard(): void;
}
interface Refs {
  statusEl: HTMLElement; roleEl: HTMLElement; textEl: HTMLElement; countEl: HTMLElement;
  prev: HTMLButtonElement; next: HTMLButtonElement; send: HTMLButtonElement; input: HTMLInputElement;
}
const cache = new WeakMap<HTMLElement, Refs>();

function build(root: HTMLElement, actions: NotchActions): Refs {
  root.innerHTML = `
    <div id="panel">
      <div class="row top">
        <span id="status" class="status"></span>
        <a id="dash" class="link nodrag" href="#">dashboard</a>
      </div>
      <div class="turn">
        <span id="role" class="role"></span>
        <div id="text" class="text nodrag"></div>
      </div>
      <div class="row nav">
        <button id="prev" class="nodrag">‹</button>
        <span id="count" class="count"></span>
        <button id="next" class="nodrag">›</button>
      </div>
      <div class="row typebox">
        <input id="msg" class="nodrag" type="text" placeholder="Ask about your screen…" />
        <button id="send" class="nodrag primary">Send</button>
      </div>
    </div>`;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const refs: Refs = {
    statusEl: $("status"), roleEl: $("role"), textEl: $("text"), countEl: $("count"),
    prev: $<HTMLButtonElement>("prev"), next: $<HTMLButtonElement>("next"),
    send: $<HTMLButtonElement>("send"), input: $<HTMLInputElement>("msg"),
  };
  const submit = () => {
    const v = refs.input.value.trim();
    if (!v) return;
    actions.send(v);
    refs.input.value = "";
  };
  refs.prev.addEventListener("click", actions.prev);
  refs.next.addEventListener("click", actions.next);
  refs.send.addEventListener("click", submit);
  refs.input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  root.querySelector<HTMLElement>("#dash")!.addEventListener("click", (e) => { e.preventDefault(); actions.openDashboard(); });
  cache.set(root, refs);
  return refs;
}

export function renderNotch(root: HTMLElement, state: NotchState, actions: NotchActions): void {
  const refs = cache.get(root) ?? build(root, actions);
  const page = pageFor(state.turns, state.index);
  refs.statusEl.textContent = state.statusLabel;
  refs.roleEl.textContent = page.item ? page.item.role : "";
  refs.textEl.textContent = page.item ? page.item.text : "Ask about your screen to begin.";
  refs.countEl.textContent = page.total ? `${page.index + 1} / ${page.total}` : "";
  refs.prev.disabled = !page.hasPrev;
  refs.next.disabled = !page.hasNext;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/notch/ui.ts
git commit -m "refactor: notch UI to text field + Send + response + pagination"
```

### Task 8: Rewrite notch `main.ts` controller

**Files:**
- Rewrite: `src/renderer/notch/main.ts`

Turn-based: lazily start a Converse on first send, push user + assistant turns, keep pagination index, relay the Ask-now hotkey. No hasKey gate, no session state machine.

- [ ] **Step 1: Replace the file**

```ts
// src/renderer/notch/main.ts
import { renderNotch, type NotchState, type NotchActions } from "./ui";
import { startConverse, type Converse } from "./realtime";
import type { Turn } from "@shared/types";

const api = (window as any).api;
const root = document.getElementById("app")!;

let turns: Turn[] = [];
let index = 0;
let statusLabel = "";
let converse: Converse | null = null;

function render() {
  const state: NotchState = { turns, index, statusLabel };
  renderNotch(root, state, actions);
}
function pushTurn(role: Turn["role"], text: string) {
  turns = [...turns, { id: Date.now() + Math.random(), sessionId: converse?.getSessionId() ?? 0, role, source: "typed", text, createdAt: Date.now() }];
  index = turns.length - 1;
  render();
}
async function ensureConverse(): Promise<Converse> {
  if (converse) return converse;
  converse = await startConverse({
    onUserText: (t) => pushTurn("user", t),
    onAssistantText: (t) => pushTurn("assistant", t),
    onStatus: (s) => { statusLabel = s === "capture-failed" ? "screen capture failed — text only" : s; render(); },
  });
  return converse;
}

const actions: NotchActions = {
  async send(text) { (await ensureConverse()).ask(text).catch(() => {}); },
  async askNow() { (await ensureConverse()).askNow().catch(() => {}); },
  prev() { index = Math.max(0, index - 1); render(); },
  next() { index = Math.min(turns.length - 1, index + 1); render(); },
  openDashboard() { api.invoke("window:openDashboard"); },
};

api.on("hotkey:askNow", () => actions.askNow());
render();
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/renderer/settings/main.ts` (still references the removed `KeyStatus` / `p.microphone` — fixed in Task 9). No errors elsewhere. Proceed.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/notch/main.ts
git commit -m "refactor: turn-based notch controller (drop session state + key gate)"
```

### Task 9: Settings — Ollama URL + model

**Files:**
- Modify: `src/renderer/settings/index.html`, `src/renderer/settings/main.ts`

- [ ] **Step 1: Replace the API-key section of `index.html`** with URL + model fields, and drop the mic permission row:

```html
    <section>
      <h2>Ollama</h2>
      <p class="hint">Local model server. Defaults to http://localhost:11434 running gemma4:26b.</p>
      <div class="row">
        <label>Base URL</label>
        <input id="ollama-url" type="text" placeholder="http://localhost:11434" />
      </div>
      <div class="row">
        <label>Model</label>
        <input id="ollama-model" type="text" placeholder="gemma4:26b" />
      </div>
      <button id="save-config">Save</button>
      <p id="config-status" class="status"></p>
    </section>

    <section>
      <h2>Permissions</h2>
      <div class="perm">
        <span>Screen Recording: <b id="screen-status">…</b></span>
        <button id="open-screen">Open Screen Recording settings</button>
      </div>
    </section>
```

(Delete the old OpenAI-key section and the microphone perm row + `req-mic` button. Keep the Shortcuts section but update it: remove the ⌘⇧M mute line.)

- [ ] **Step 2: Replace `settings/main.ts`**

```ts
// src/renderer/settings/main.ts
import type { ConfigData, PermissionStatus } from "@shared/types";

const api = (window as any).api;
const urlInput = document.getElementById("ollama-url") as HTMLInputElement;
const modelInput = document.getElementById("ollama-model") as HTMLInputElement;
const saveBtn = document.getElementById("save-config") as HTMLButtonElement;
const cfgStatus = document.getElementById("config-status")!;
const screenStatusEl = document.getElementById("screen-status")!;
const openScreenBtn = document.getElementById("open-screen") as HTMLButtonElement;

async function loadConfig() {
  const c = (await api.invoke("config:get")) as ConfigData;
  urlInput.value = c.ollamaUrl;
  modelInput.value = c.model;
}
saveBtn.addEventListener("click", async () => {
  await api.invoke("config:set", { ollamaUrl: urlInput.value.trim(), model: modelInput.value.trim() });
  cfgStatus.textContent = "✓ Saved.";
  cfgStatus.className = "status ok";
});
async function refreshPermissions() {
  const p = (await api.invoke("perm:status")) as PermissionStatus;
  screenStatusEl.textContent = p.screen;
}
openScreenBtn.addEventListener("click", () => api.invoke("perm:openScreenSettings"));

loadConfig();
refreshPermissions();
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/settings/index.html src/renderer/settings/main.ts
git commit -m "feat: settings for Ollama url + model; drop API key + mic UI"
```

### Task 10: Remove dependency, full build + test

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove the dependency**

```bash
npm uninstall @openai/agents-realtime
```

- [ ] **Step 2: Grep for stragglers**

Run: `grep -rn "openai\|agents-realtime\|tokenMint\|keyStore\|mapServerEvent\|sessionState\|HOTKEY_TOGGLE_MUTE\|EphemeralToken" src/ tests/`
Expected: no matches (or only in comments/spec you intend to keep).

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS (configStore, ollamaClient, pagination, historyStore).

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 5: Manual smoke (requires Ollama + Handy running)**

1. `ollama serve` with `gemma4:26b` pulled; launch `npm run dev`.
2. In the notch, type a question → Send → a screenshot is captured, Ollama replies, the reply renders.
3. Prev/Next pages through turns; counter updates.
4. Dictate via Handy into the field → Send works identically.
5. Stop Ollama → Send shows the "not reachable" error; the field keeps the text.
6. Settings: change model to a bad name → Send surfaces the model error; fix it → works.
7. Dashboard lists the session, turns, and screenshots; FTS search finds the question text.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: drop @openai/agents-realtime; Phase A local Ollama complete"
```

---

## Done criteria (Phase A)

- App runs with no OpenAI code; a Send captures the screen and gets a text reply from local Ollama.
- Settings configures Ollama URL + model; changes take effect on the next Send.
- History, Dashboard, search, tray, capture all work unchanged.
- `npm test`, `npx tsc --noEmit`, `npm run build` all green.
- OpenAI version remains on `feature/openai-realtime`.

**Next:** Phase B plan — rebuild the notch as a Cody-style morphing pill (drag/snap, resize, opacity, hover-reveal), reusing this pipeline unchanged.
