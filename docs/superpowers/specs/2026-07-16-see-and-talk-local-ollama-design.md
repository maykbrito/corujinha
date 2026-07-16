# See-and-Talk — Local (Ollama) Migration Design Spec

**Date:** 2026-07-16
**Status:** Draft for review
**Platform:** macOS only
**Supersedes runtime brain of:** `2026-07-15-see-and-talk-design.md` (OpenAI Realtime v1)

## 1. Summary

See-and-Talk currently talks to OpenAI's Realtime API over WebRTC, bundling STT + LLM +
vision + TTS into one live session. A minimal 3-minute interaction costs nearly **$1**. This
migration replaces the cloud brain with a **fully local, zero-cost** pipeline:

- **Input (STT):** handled **entirely outside the app** by **Handy** (Parakeet V3). Handy is a
  system-wide dictation tool that types transcribed speech into whatever field is focused. The
  user dictates into our app's **text field** — we never touch audio.
- **Brain (LLM + Vision):** **Ollama**, OpenAI-compatible endpoint
  (`http://localhost:11434/v1`), model `gemma4:26b`. Receives the typed/dictated text **plus a
  screenshot** and returns text.
- **Output:** **text only**, rendered in the notch. No TTS.

The interaction model changes from a live always-listening voice conversation to a **turn-based
request/response**: the user puts text in the field (by voice via Handy, or by typing), clicks
**Send**, the app auto-captures the screen, sends both to Ollama, and displays the reply.

The **notch UI is rebuilt to copy Cody.app exactly** — a Dynamic-Island pill that morphs into a
draggable, resizable, opacity-adjustable panel.

**The current OpenAI implementation is preserved on the branch `feature/openai-realtime`** so we
can return to it if desired.

## 2. Scope

### In scope

- Remove OpenAI Realtime entirely: `@openai/agents-realtime` dependency, `tokenMinter.ts`,
  WebRTC session, ephemeral-token minting, `mapServerEvent`, voice in/out.
- Add an **Ollama client** in the main process: `POST {baseURL}/v1/chat/completions` with a
  vision message (text + base64 image), OpenAI-compatible shape.
- Rebuild the **notch** to copy Cody's `notch-bubble` behavior:
  - Collapsed **pill** (300×34) top-center; **expanded panel** (436×212 default, resizable
    360–900 × 160–640); spring/ease morph animations; fade in/out.
  - **Drag** via header handle, **snap back** to the notch origin within 150px (pinned) else
    floating; distinct border-radii per state.
  - **Opacity slider** (0.45–1.0) in a settings sub-panel.
  - **Hover-reveal** controls; click-through outside the visible shape.
- Notch expanded content: **text field + Send button**, **response area** (scrollable, markdown),
  **prev/next pagination** across turns with a counter, **collapse button**, **settings gear**.
- **Auto-capture** the whole screen on every Send (WebP, reusing the existing captureWorker).
- **Settings**: configurable Ollama **base URL** (default `http://localhost:11434`) and **model**
  (default `gemma4:26b`), replacing the OpenAI API-key section. Screen-recording permission row
  stays.
- **Keep unchanged:** SQLite history (sessions/turns/captures/FTS), Dashboard window + search,
  captureWorker, tray, thumbnail storage.

### Out of scope

- Any in-app audio: STT, TTS, mic capture, WebRTC. (Handy owns input; output is text.)
- Streaming token-by-token rendering (v1 of this migration renders the full reply; may add later).
- Model-driven tools (`note_screen`, `capture_screen`). Screen summary is derived differently
  (§4.4).
- Conversation-style auto-turns / semantic VAD. Turns are explicit (Send button).
- Cross-platform, local model management/installation (user runs Ollama + Handy themselves).

## 3. Key decisions (with rationale)

| Decision | Choice | Rationale |
|---|---|---|
| Brain | Ollama `gemma4:26b` via OpenAI-compatible `/v1/chat/completions` | Local, free; same wire format we already understand; vision-capable. |
| STT | **External (Handy/Parakeet)** — none in-app | User already runs Handy; it types into our field. Zero audio code to own. |
| TTS | **None** — text output only | User explicitly does not want spoken replies. |
| Interaction | **Turn-based**, explicit Send button | No live session; a request/response is all Ollama needs. Simplest correct model. |
| Screen capture | Whole screen, **auto on every Send**, WebP | It's a "see and talk" app; the screenshot is the point. Reuse existing captureWorker. |
| Ollama fetch location | **Main process** (IPC `ollama:chat`) | Keeps the network call off the renderer; consistent with the old token-mint pattern; avoids CORS. |
| Config | Ollama URL + model, stored + editable in Settings | Change model/port without rebuilding. |
| Config storage | Plain JSON in `userData` (not `safeStorage`) | A localhost URL + model name are not secrets. Drop the encryption path. |
| Notch UI | **Copy Cody exactly** (pill/expand/drag/snap/resize/opacity/hover) | User's explicit request; Cody's behavior is the proven reference. |
| Pagination | **Kept** in the notch (prev/next + counter) | User's explicit request; lets them browse turns without the dashboard. |
| Backup | Preserve OpenAI build on `feature/openai-realtime` | User may want to return to the cloud version. |
| Persistence | Unchanged SQLite + FTS | Working well; the only change is what fills `turns`/`captures`. |

## 4. Architecture

### 4.1 The turn pipeline

There is no live session. One turn is one request:

```
Handy (Parakeet) ─types──▶ notch text field
User clicks Send
  └─▶ captureWorker: whole screen ─▶ WebP data URL
  └─▶ persist user turn + capture row (SQLite)
  └─(IPC ollama:chat)─▶ Main: POST {baseURL}/v1/chat/completions
        body: recent context + { text, image_url: data:image/webp;base64,... }
  ◀── assistant text ──┘
  └─▶ persist assistant turn (SQLite)
  └─▶ render in notch response area; pagination counter advances
```

### 4.2 Processes & windows

**Main process (Node)**
- **OllamaClient** (new) — `chat({ baseURL, model, messages })` → text. Wraps
  `POST /v1/chat/completions`; maps our context + image into OpenAI-compatible `messages`
  (vision content array). Handles connection errors (Ollama not running) with a clear message.
- **ConfigStore** (new, replaces KeyStore) — reads/writes `{ ollamaUrl, model }` as JSON in
  `userData`. Defaults `http://localhost:11434` + `gemma4:26b`.
- **ScreenCapturer** — **unchanged** (captureWorker + WebP).
- **HistoryStore** — **unchanged**.
- **PermissionsManager** — screen-recording only (mic no longer needed).
- **ShortcutManager** — adapt: "Ask now" → capture + send the field's current text (or a default
  "describe my screen" prompt if empty); show/hide notch; drop toggle-mute.

**Windows**
- **Notch panel** (`notch`) — rebuilt to Cody's `notch-bubble` model (§4.3). Owns the text field,
  Send, response rendering, pagination, drag/resize/opacity, and the `ollama:chat` calls via IPC.
- **Dashboard** (`dashboard`) — **unchanged**.
- **Settings** (`settings`) — Ollama URL + model + screen-recording permission.
- **Capture worker** (`captureWorker`) — **unchanged**.
- **Tray** — **unchanged** (Dashboard / Settings / Quit).

### 4.3 Notch behavior (copied from Cody)

Reference: `Cody.app` `electron/notchBubble.js`, `notch-bubble.html`, `appWindowOpacityController.js`.

- **Window flags:** frameless, transparent, `hasShadow:false`, `alwaysOnTop:'screen-saver'`,
  `type:'panel'` (macOS), `setVisibleOnAllWorkspaces({visibleOnFullScreen:true})`,
  `focusable:false` until interaction. Top-center via primary-display bounds.
- **Two visual states in one morphing shape:**
  - Collapsed pill 300×34, `border-radius: 0 0 24px 24px`.
  - Expanded panel: width from stored size, height content-driven; `border-radius: 0 0 20px 20px`.
  - Floating variants get all-corner radii.
- **Morph transitions:** expand = spring `cubic-bezier(0.34,1.56,0.64,1)`; collapse = ease-out
  `cubic-bezier(0.4,0,0.2,1)`. Inner content fades/translates with a delay.
- **Fade in/out** of the whole window (opacity 0↔target) on show/hide, quadratic easing.
- **Click-through:** `setIgnoreMouseEvents(true,{forward:true})` by default; the renderer toggles
  it off while the pointer is inside the shape (macOS path — no Windows `setShape`).
- **Drag:** header is the handle; threshold 4px; throttle moves to one/frame; on drop, snap to
  origin if within 150px (pinned) else stay (floating). `get-position` / `get-notch-position` /
  `move` / `set-pinned` IPC mirror Cody.
- **Resize:** right + bottom handles; clamp 360–900 × 160–640; persist size in `localStorage`.
- **Opacity:** slider 0.45–1.0 sets a CSS `--notch-background-opacity` on the surface; persist in
  `localStorage`. (We tint the surface, matching Cody, rather than the whole `win.setOpacity`.)
- **Hover-reveal:** header actions, collapse, nav, resize handles are `opacity:0` until
  `.hovering`/`.dragging`/`.resizing`.

### 4.4 Screen summary (captures.summary)

The old app had the model call `note_screen` to fill `captures.summary`. With no tool loop, we
fill it more simply: after a turn completes, **store the user's question text as the capture
summary** (best-effort), so the Dashboard's FTS still indexes what each screenshot was about.
The column and FTS indexing are unchanged; only the source of the string changes. (A future
option: a cheap second Ollama call to summarize the image — deferred, YAGNI.)

## 5. Data model (SQLite + FTS5)

**Unchanged** from the current schema:

- **sessions** — `id`, `mode` (`converse`), `model` (now e.g. `gemma4:26b`), `started_at`,
  `ended_at`, `status`.
- **turns** — `id`, `session_id`, `role` (user|assistant), `source` (now `typed` for all —
  Handy-dictated text arrives as typed), `text`, `created_at`.
- **captures** — `id`, `session_id`, `turn_id`, `thumb_path`, `summary`, `created_at`.
- **FTS5** over `turns.text` + `captures.summary`.

No migration needed; existing rows remain valid.

## 6. Controls & shortcuts

- **Send** — capture screen + send field text to Ollama.
- **Text field** — Handy dictates here, or the user types.
- **Prev / Next** — page through turns (counter "n / total").
- **Collapse** — morph the panel back to the pill.
- **Settings gear** — opacity slider, Ollama URL, model.
- **Global shortcuts** — Ask now (capture + send current/empty-default prompt), show/hide notch.
  Drop toggle-mute (no mic).

## 7. Error handling

- **Ollama unreachable** (not running / wrong URL) — the `ollama:chat` call fails; the notch shows
  a clear, actionable error ("Ollama not reachable at <url> — is it running?") with the turn text
  preserved in the field for retry.
- **Model not found** — surface Ollama's error message; hint to `ollama pull <model>` or pick
  another in Settings.
- **Capture failure** — proceed text-only for that turn (send without image); badge the notch;
  don't block.
- **Screen-recording permission missing** — detect, prompt, deep-link to System Settings; sending
  still works but without vision.
- **Empty field on Send** — no-op (or, for Ask-now shortcut, use a default "describe my screen"
  prompt).

## 8. Testing

- **Unit (runnable checks, no heavy frameworks):**
  - **OllamaClient** — builds the correct OpenAI-compatible `messages` body from context + image;
    parses the assistant text from a mocked response; maps a connection error to a clear message.
    (Inject `fetch` as a port.)
  - **ConfigStore** — default values; round-trip read/write; malformed-file fallback to defaults.
  - **Pagination** — existing `pageFor`/`clampIndex` tests stay green (behavior kept).
  - **HistoryStore** — existing tests stay green (schema unchanged).
- **Delete/replace:** `keyStore.test.ts` (KeyStore removed), `realtimeEvents.test.ts`
  (`mapServerEvent` removed), `sessionState.test.ts` if the start/pause/stop machine is dropped
  (see §10).
- **Manual smoke:** dictate via Handy into the field → Send → screenshot captured → Ollama reply
  renders; collapse/expand morph; drag + snap; resize; opacity; pagination; Ollama-down error;
  Settings URL/model change takes effect.

## 9. Tech stack

- Electron (unchanged), macOS target.
- **Ollama** (user-run) via OpenAI-compatible `/v1/chat/completions`, model `gemma4:26b`.
- `better-sqlite3` + FTS5 (unchanged).
- `desktopCapturer` + Chromium `canvas.toDataURL('image/webp')` (unchanged).
- **Removed:** `@openai/agents-realtime`, `safeStorage` key path, ephemeral tokens.
- **External runtime deps (not bundled):** Ollama, Handy.

## 10. Open questions / assumptions

- **Context window:** how many prior turns to resend to Ollama each request. Assume **last 10**
  (5 exchanges); tune in implementation. Images: send only the **current** turn's screenshot to
  keep payload small (prior turns as text only).
- **Session lifecycle:** without a live connection, do we keep the `sessionState` start/pause/stop
  machine? Assumption: a "session" becomes lightweight — created on first Send, ended on notch
  collapse/quit. `pause`/`mute` states are dropped. Confirm during planning; may retire
  `sessionState.ts` + its tests.
- **`source` field:** Handy-dictated text is indistinguishable from typed. Assumption: record all
  as `typed`. Acceptable.
- **Gemma model name:** the screenshot shows `gemma4:26b`; the exact local tag is the user's to
  set in Settings. Default is a best guess and editable.
- **Markdown rendering:** reuse Cody's lightweight inline renderer vs. a small lib. Assumption:
  minimal hand-rolled renderer (bold/italic/code/lists), matching Cody, no new dependency.
