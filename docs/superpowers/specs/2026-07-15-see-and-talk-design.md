# See-and-Talk — Design Spec

**Date:** 2026-07-15
**Status:** Draft for review
**Platform:** macOS only (v1)

## 1. Summary

See-and-Talk is a macOS Electron app: an AI study/assist companion that **sees your whole
screen** and **talks with you** by voice (and text when you prefer to type). It lives in a
floating **Dynamic-Island-style notch panel** you can drag and resize, and it keeps a full,
searchable history of every conversation in local SQLite.

**v1 is a single mode — Converse:** turn-based voice chat. You talk (mic) or type, and it replies
by voice, always seeing your current screen. For active study: drawing a system-design diagram on
a canvas and talking it through, or reading docs and asking questions. A **"Ask now"** button/
shortcut lets you get a response about what's on screen without saying or typing anything.

Two further modes are planned for **v2** (see §11): **Watch-along** (proactively comment on a
video) and **Call/Meeting** (live multilingual comprehension + typed follow-ups during a call).
They share a separate "Observer" engine and are deliberately out of v1.

### Why v1 beats the reference app (Cody)

Cody (an existing Electron app the user has) transcribes locally, waits for end-of-speech (VAD),
*then* sends text to an LLM with debounced/manual triggers — which is why it feels non-real-time.
See-and-Talk Converse uses **OpenAI's Realtime API (`gpt-realtime-2.1`) speech-to-speech** over
WebRTC: one live session that hears you, reasons, sees screenshots, and speaks back with no batch
step. Verified against OpenAI docs: the Realtime model supports audio in/out **plus image input
plus function calling** in the same session.

## 2. Scope

### In scope (v1) — Converse only

- macOS only.
- Converse: mic voice-to-voice via OpenAI Realtime, semantic VAD (auto-reply when you pause),
  instant spoken reply.
- Type box for text input when you'd rather not speak.
- **"Ask now"** button + global shortcut: capture the screen and ask the AI to respond about it
  with no spoken/typed prompt.
- Whole-screen capture on **every user turn**, downscaled **WebP**. Plus a model-driven
  **"look again"** tool for mid-turn re-checks.
- **`note_screen`** tool: the model records a short text summary of each newly-seen screen (§4.4).
- Notch panel UI: paginated turns (prev/next), type box, play/pause/stop, mute. Draggable +
  resizable (vertical & horizontal).
- Dashboard window: browse + full-text search history.
- Settings/onboarding window; tray (menu-bar) icon.
- SQLite (`better-sqlite3`) + FTS5 as the durable source of truth, including image summaries.
- Encrypted API-key storage + ephemeral-token minting.

### Out of scope (v1)

- **The Observer engine and its modes — Watch-along and Call/Meeting (→ v2, §11).**
- System/loopback audio capture (v1 is **mic only**).
- Proactive screen nudges / change-detector (v1 is **purely turn-based**; proactivity → v2).
- TTS for non-Converse modes (voice is Converse-only).
- Cross-platform (Windows/Linux).
- Local models (Handy-style local STT/LLM via Ollama). **v1 is OpenAI-Realtime-only.**
- OCR of screenshots.
- Preset personas (one general assistant prompt).
- Shipping a virtual audio driver.

## 3. Key decisions (with rationale)

| Decision | Choice | Rationale |
|---|---|---|
| Platform | macOS only | Notch UI, menu-bar patterns; simplest v1. |
| v1 scope | **Converse engine only** | Focus; ship the truly-instant core first. Observer engine (Watch-along, Call) is v2. |
| Conversation model | Turn-based, always-listening mic | True conversation via semantic VAD, not push-to-talk. Proactive nudges deferred to v2. |
| API / brain | OpenAI Realtime (`gpt-realtime-2.1`) over WebRTC | Only path that does live voice-to-voice + vision in one session. **Not** the Vercel AI SDK (text/turn-based). **Not** local models in v1. |
| Screen capture | Whole screen, every user turn, downscaled **WebP** | Vision is the app's soul — it must see the current screen as you discuss it. WebP: supported by OpenAI, smaller than JPEG; encoded free via Chromium canvas (no `sharp`). AVIF not supported. |
| On-demand vision | "look again" tool + "Ask now" button/shortcut | Model can re-check mid-turn; user can request a screen-based reply with no words. |
| Window architecture | Separate floating windows (not one full-screen overlay) | A full-screen overlay would block desktop interaction. |
| Auth | Main process mints ephemeral tokens; key encrypted via `safeStorage` | Key never sits in the renderer; OpenAI's intended pattern. |
| Primary UI | Everything in the notch panel (answers + type box + controls) | Light, draggable, single focus. |
| Turn display | Paginated (prev/next), one turn at a time | Keeps the notch small; user can expand. |
| Persistence | SQLite (`better-sqlite3`) + FTS5, source of truth | Survives Realtime compaction / 60-min reconnect; nothing lost. |
| Screenshot storage | Thumbnail on disk + **text summary** in DB | Keeps DB light; later turns reference the summary, not the full image. |

## 4. Architecture (v1)

### 4.1 The Converse engine

v1 has one engine: a **WebRTC Realtime session** in the notch renderer.

- **Audio in:** microphone (`getUserMedia`), added as a track to the peer connection.
- **Turn detection:** `semantic_vad` — the model auto-replies when you finish speaking.
- **Audio out:** the model's spoken reply, played in the renderer. Voice on by default; mute
  silences the mic (privacy kill switch).
- **Text in:** typed messages are sent as `input_text` conversation items.
- **Vision:** on every user turn, and on "Ask now," a fresh whole-screen **WebP** screenshot is
  injected as `input_image` content before the response. The model can also pull a fresh frame
  mid-turn via the **`capture_screen`** ("look again") tool.
- **Screen summaries:** the model calls **`note_screen(summary)`** to record what a new screen
  shows (§4.4).

### 4.2 Processes & windows

**Main process (Node)**
- **KeyStore** — API key encrypted via Electron `safeStorage`, persisted in `userData`.
- **TokenMinter** — calls `POST /v1/realtime/client_secrets` to mint short-lived tokens for the
  renderer's WebRTC connection. The long-lived key never leaves main.
- **ScreenCapturer** — whole-screen capture via `desktopCapturer` in a hidden offscreen worker
  window; downscale + encode WebP via `canvas.toDataURL('image/webp', q)` in that renderer.
- **HistoryStore** — `better-sqlite3` database; the IPC hub for reads/writes from all windows.
- **PermissionsManager** — screen-recording + microphone permission prompts and status.
- **ShortcutManager** — registers global shortcuts (Ask now, mute/listen, show/hide notch).

**Windows**
- **Notch panel** (`notch`) — transparent, frameless, `alwaysOnTop:'screen-saver'`,
  `type:'panel'`, `focusable:false`, `setVisibleOnAllWorkspaces({visibleOnFullScreen:true})`,
  click-through via `setIgnoreMouseEvents(true,{forward:true})` toggled per interactive region.
  Top-center default; draggable + resizable (V & H). **Owns the WebRTC Realtime session** and all
  live conversation UI. (Window flags mirror Cody's proven `notchBubble.js`.)
- **Dashboard** (`dashboard`) — normal window; browse + FTS5 search of history.
- **Settings/Onboarding** (`settings`) — normal window; API key entry, shortcut config,
  permission status.
- **Tray icon** — open dashboard/settings, toggle listen, quit. Avoids dock clutter.
- **Capture worker** (`captureWorker`) — hidden offscreen window for `desktopCapturer` + WebP
  encode.

### 4.3 Data flow

```
mic ──▶ Notch renderer ──(WebRTC)──▶ OpenAI Realtime
                     ◀── voice + transcript deltas ──
Notch renderer ──(IPC)──▶ Main: request screenshot ──▶ inject input_image (WebP)
Every event (user transcript, AI transcript, typed text, tool calls,
             capture + summary, timestamps) ──(IPC)──▶ HistoryStore (SQLite)
Dashboard ──(IPC)──▶ HistoryStore (read + FTS5 search)
```

Events are appended to SQLite **as they stream**, so a Realtime compaction, context-window
truncation, or the 60-minute session cap never loses history. On reconnect, a summary drawn from
SQLite can seed the new session for continuity.

### 4.4 Model tools

The Realtime session is given two function tools:

- **`capture_screen`** ("look again") — when the model calls it, main captures a fresh WebP frame;
  the renderer injects it as an `input_image` item and issues `response.create`. Lets the AI
  re-check the screen mid-thought ("keep drawing… okay, now I see the load balancer").
- **`note_screen(summary)`** — the system prompt instructs the model to call this with a one-to-
  two-sentence description whenever it's given a newly-captured screen. The summary is written to
  `captures.summary` (§5), keeping summary generation inside the single session (no second model)
  and feeding reconnect-seeding. Fallback: if the model doesn't call it for a capture, the row is
  stored with an empty summary rather than blocking.

## 5. Data model (SQLite + FTS5)

- **sessions** — `id`, `mode` (converse; reserved for v2 modes), `model`, `started_at`,
  `ended_at`, `status`.
- **turns** — `id`, `session_id`, `role` (user|assistant), `source` (voice|typed), `text`,
  `created_at`. Ordered; drives notch pagination.
- **captures** — `id`, `session_id`, `turn_id` (nullable), `thumb_path` (on disk),
  `summary` (text of what was seen, produced by the `note_screen` tool — §4.4), `created_at`.
- **FTS5 virtual table** over `turns.text` + `captures.summary` for dashboard search.

Thumbnails are written to `userData/captures/`; only the path + summary live in the DB.

## 6. Controls & shortcuts (v1)

- **Play/Start** — open session, begin listening.
- **Pause** — stop feeding the mic (session stays warm); resume without reconnecting.
- **Stop** — end session, finalize it in history.
- **Mute** — silence mic input quickly (privacy kill switch).
- **Ask now** — capture the screen and ask the AI to respond about it, no words needed.
- **Prev / Next** — page through turns in the notch.
- **Global shortcuts** — Ask now, toggle listen/mute, show/hide notch (configurable in settings).

## 7. Error handling

- **Session limits/drops** — auto-reconnect on the 60-min cap or network drop; seed the new
  session with a history-derived summary; surface a subtle "reconnecting" state in the notch.
- **No API key** — onboarding blocks start until a key is stored; clear guidance.
- **Token-mint failure** — surfaced in the notch with a retry.
- **Permissions** — detect missing Screen Recording / Microphone permission; prompt and deep-link
  to System Settings; degrade gracefully (voice/text still work without screen-recording, minus
  vision).
- **Capture failure** — proceed audio-only for that turn; log; don't crash the session.

## 8. Testing

- **Unit (runnable checks, no heavy frameworks):**
  - HistoryStore repository (insert/query turns & captures, FTS5 search) against a temp DB.
  - Turn pagination (prev/next boundaries).
  - Mode/state resolver for the session lifecycle (start/pause/stop transitions).
  - `note_screen` capture-row handling incl. the empty-summary fallback.
- **Manual smoke** (hardware/permission-dependent): WebRTC connect, mic capture, screenshot
  injection + WebP encode, voice playback, "Ask now", reconnect on cap.

## 9. Tech stack

- Electron (latest), macOS target.
- OpenAI Realtime API via WebRTC — `@openai/agents-realtime` SDK (or raw WebRTC) with
  `gpt-realtime-2.1`.
- `better-sqlite3` for storage; FTS5 for search.
- `desktopCapturer` for frames; WebP encode via Chromium `canvas.toDataURL` (no `sharp`).
- `safeStorage` for the API key.

## 10. Open questions / assumptions (v1)

- Exact downscale target and WebP quality to balance vision accuracy vs cost/latency — tune during
  implementation. Fallback if per-turn cost bites: capture on first turn + on-demand only.
- Whether reconnect-seeding uses a rolling summary or last-N turns — decide in implementation.
- Voice selection (`marin`/`cedar` recommended by OpenAI) — pick a sensible default, expose later.

## 11. Future (v2) — the Observer engine

A **second, independent engine** for observing continuous audio + screen and producing **text**
output (no TTS). It is decoupled from the Converse Realtime session because continuous streams
have no turn boundary — a shared commit-then-respond loop over Realtime proved fragile. The
Observer captures loopback/system audio (ScreenCaptureKit, no driver install) + screenshots,
transcribes, and sends transcript + image to a vision model on a trigger. Two presets:

| | Watch-along | Call / Meeting |
|---|---|---|
| Purpose | Comment/quiz/explain a video | Live multilingual comprehension + follow-ups |
| Trigger | Proactive timer (default 5s, adjustable) + manual "reply now" | On-demand only (type a question / hit reply-now) |
| Audio | Loopback (media) | Loopback (them) + your mic (full two-sided transcript) |
| Output | Text bubbles | Text bubbles + translation |

v2 also brings: **proactive screen nudges** for Converse (shared trigger machinery — a
ChangeDetector diffs frames and prompts a reply on meaningful change, with a "Proactive comments"
settings toggle), a mode switcher UI in the notch, and the adjustable watch-along interval. These
are intentionally excluded from v1 to keep the first release a tight, truly-real-time Converse
experience.
