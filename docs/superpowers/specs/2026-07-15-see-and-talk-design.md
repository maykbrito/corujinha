# See-and-Talk — Design Spec

**Date:** 2026-07-15
**Status:** Draft for review
**Platform:** macOS only (v1)

## 1. Summary

See-and-Talk is a macOS Electron app: an always-listening AI study/assist companion that
**sees your whole screen** and **talks with you** by voice (and text when you prefer to type).
It lives in a floating **Dynamic-Island-style notch panel** you can drag and resize, and it
keeps a full, searchable history of every conversation in local SQLite.

It has two modes:

- **Converse** — turn-based voice chat. You talk (mic), it replies instantly by voice. For
  active study: drawing a system-design diagram on a canvas, reading docs and asking questions.
- **Watch-along** — the AI observes a video/screen (system audio + screenshots) and proactively
  comments on a short timer (default 5s, adjustable) or when you hit a "reply now"
  button/shortcut.

Both modes attach the current screen so the AI reasons about what you're looking at right now.

### Why this beats the reference app (Cody)

Cody (an existing Electron app the user has) transcribes locally, waits for end-of-speech (VAD),
*then* sends text to an LLM with debounced/manual triggers — which is why it feels non-real-time.
See-and-Talk instead uses **OpenAI's Realtime API (`gpt-realtime-2.1`) speech-to-speech** over
WebRTC: one live session that hears you, reasons, sees screenshots, and speaks back with no batch
step. Verified against OpenAI docs: the Realtime model supports audio in/out **plus image input
plus function calling** in the same session.

## 2. Scope

### In scope (v1)

- macOS only.
- Converse mode (mic, turn-based, semantic VAD, instant voice reply).
- Watch-along mode (system/loopback audio + screenshots, timer + manual trigger).
- Whole-screen capture, downscaled JPEG. On-turn + on-demand ("look again" tool) +
  throttled change-detector.
- Notch panel UI: paginated turns (prev/next), type box, play/pause/stop, mute, mode toggle,
  "reply now", dashboard link. Draggable + resizable (vertical & horizontal).
- Dashboard window: browse + full-text search history.
- Settings/onboarding window; tray (menu-bar) icon.
- SQLite (`better-sqlite3`) as the durable source of truth, including image summaries.
- Encrypted API-key storage + ephemeral-token minting.

### Out of scope (v1, noted for later)

- Cross-platform (Windows/Linux).
- Local models (Handy-style local STT/LLM via Ollama). **v1 is OpenAI-Realtime-only.**
- OCR of screenshots.
- Preset personas/modes (one general assistant prompt).
- Preset "AI voice off / audio streaming toggle" beyond a mute button (voice is on by default).
- Shipping a virtual audio driver (we use ScreenCaptureKit loopback, no driver install).

## 3. Key decisions (with rationale)

| Decision | Choice | Rationale |
|---|---|---|
| Platform | macOS only | Notch UI, ScreenCaptureKit, menu-bar patterns; simplest v1. |
| Conversation model | Always-listening | User wants true conversation, not push-to-talk. |
| API / brain | OpenAI Realtime (`gpt-realtime-2.1`) over WebRTC | Only path that does live voice-to-voice + vision in one session. **Not** the Vercel AI SDK (text/turn-based). **Not** local models in v1. |
| Screen capture | Whole screen, downscaled JPEG | Simplest; always sees everything. |
| Capture timing | Hybrid: on-turn + on-demand tool + throttled change-detector | "Real-time feel" without streaming video (models see stills, not video). |
| Window architecture | Separate floating windows (not one full-screen overlay) | A full-screen overlay would block desktop interaction. |
| Auth | Main process mints ephemeral tokens; key encrypted via `safeStorage` | Key never sits in the renderer; OpenAI's intended pattern. |
| Primary UI | Everything in the notch panel (answers + type box + controls) | Light, draggable, single focus. |
| Turn display | Paginated (prev/next), one turn at a time | Keeps the notch small; user can expand. |
| Persistence | SQLite (`better-sqlite3`) + FTS5, source of truth | Survives Realtime compaction / 60-min reconnect; nothing lost. |
| Screenshot storage | Thumbnail on disk + **text summary** in DB | Keeps DB light; later turns reference the summary, not the full image. |
| Watch-along trigger | Timer (default 5s, adjustable) + manual button/shortcut | Continuous streams have no turn boundary; a trigger is unavoidable. |

## 4. Architecture

### 4.1 Unified Realtime session

**One** WebRTC Realtime session powers both modes. Mode controls exactly two knobs:

| Knob | Converse | Watch-along |
|---|---|---|
| Audio source fed to input | Microphone | System/loopback audio (the video) |
| Response trigger | `semantic_vad` (auto-reply on pause) | VAD off; `response.create` on timer (5s) or manual "reply now" |

Both modes attach the latest screenshot (as `input_image` content) and can reference stored
image summaries. Same connection, same model, two code paths that differ only in these knobs.

### 4.2 Processes & windows

**Main process (Node)**
- **KeyStore** — API key encrypted via Electron `safeStorage`, persisted in `userData`.
- **TokenMinter** — calls `POST /v1/realtime/client_secrets` to mint short-lived tokens for
  the renderer's WebRTC connection. The long-lived key never leaves main.
- **ScreenCapturer** — whole-screen capture via `desktopCapturer` in a hidden offscreen worker
  window; downscale to ~1280px wide JPEG. Serves on-turn, on-demand, and change-detector needs.
- **ChangeDetector** — cheap perceptual diff on downscaled frames; emits "screen changed" when a
  threshold is exceeded, throttled (min interval). Drives proactive nudges. Toggleable.
- **SystemAudio** — loopback capture via ScreenCaptureKit (no driver install) for Watch-along.
- **HistoryStore** — `better-sqlite3` database; the IPC hub for reads/writes from all windows.
- **PermissionsManager** — screen-recording + microphone permission prompts and status.

**Windows**
- **Notch panel** (`notch`) — transparent, frameless, `alwaysOnTop:'screen-saver'`,
  `type:'panel'`, `focusable:false`, `setVisibleOnAllWorkspaces({visibleOnFullScreen:true})`,
  click-through via `setIgnoreMouseEvents(true,{forward:true})` toggled per interactive region.
  Top-center default; draggable + resizable (V & H). **Owns the WebRTC Realtime session** and all
  live conversation UI. (Window flags mirror Cody's proven `notchBubble.js`.)
- **Dashboard** (`dashboard`) — normal window; browse + FTS5 search of history.
- **Settings/Onboarding** (`settings`) — API key entry, watch-along interval, shortcut config,
  permission status.
- **Tray icon** — open dashboard/settings, toggle listen, quit. Avoids dock clutter.
- **Capture worker** (`captureWorker`) — hidden offscreen window for `desktopCapturer`.

### 4.3 Data flow

```
mic / system-audio ──▶ Notch renderer ──(WebRTC)──▶ OpenAI Realtime
                                    ◀── voice + transcript deltas ──
Notch renderer ──(IPC)──▶ Main: request screenshot ──▶ inject input_image
Every event (user transcript, AI transcript, typed text, tool calls,
             capture + summary, timestamps) ──(IPC)──▶ HistoryStore (SQLite)
Dashboard ──(IPC)──▶ HistoryStore (read + FTS5 search)
```

Events are appended to SQLite **as they stream**, so a Realtime compaction, context-window
truncation, or the 60-minute session cap never loses history. On reconnect, a summary drawn from
SQLite can seed the new session for continuity.

### 4.4 "Look again" tool

The Realtime session is given a function tool `capture_screen`. When the model calls it, main
captures a fresh frame; the renderer injects it as an `input_image` conversation item and issues
`response.create`. This lets the AI re-check the screen mid-thought ("keep drawing… okay, now I
see the load balancer").

## 5. Data model (SQLite + FTS5)

- **sessions** — `id`, `mode` (converse|watch_along), `model`, `started_at`, `ended_at`, `status`.
- **turns** — `id`, `session_id`, `role` (user|assistant), `source` (voice|typed|system_audio),
  `text`, `created_at`. Ordered; drives notch pagination.
- **captures** — `id`, `session_id`, `turn_id` (nullable), `thumb_path` (on disk),
  `summary` (text of what was seen), `created_at`.
- **FTS5 virtual table** over `turns.text` + `captures.summary` for dashboard search.

Thumbnails are written to `userData/captures/`; only the path + summary live in the DB.

## 6. Controls & shortcuts

- **Play/Start** — open session, begin listening (mode-appropriate source).
- **Pause** — stop feeding mic/audio (session stays warm); resume without reconnecting.
- **Stop** — end session, finalize it in history.
- **Mute** — silence mic input quickly (privacy kill switch).
- **Mode toggle** — Converse ⇄ Watch-along.
- **Reply now** — Watch-along manual trigger.
- **Prev / Next** — page through turns in the notch.
- **Global shortcuts** — toggle listen/mute, reply-now, show/hide notch, switch mode
  (configurable in settings).

## 7. Error handling

- **Session limits/drops** — auto-reconnect on the 60-min cap or network drop; seed the new
  session with a history-derived summary; surface a subtle "reconnecting" state in the notch.
- **No API key** — onboarding flow blocks start until a key is stored; clear guidance.
- **Token-mint failure** — surfaced in the notch with a retry.
- **Permissions** — detect missing Screen Recording / Microphone permission; prompt and deep-link
  to System Settings; degrade gracefully (e.g., Watch-along disabled without screen-recording).
- **Capture failure** — proceed audio-only for that turn; log; don't crash the session.

## 8. Testing

- **Unit (runnable checks, no heavy frameworks):**
  - HistoryStore repository (insert/query turns & captures, FTS5 search) against a temp DB.
  - ChangeDetector diff threshold logic.
  - Mode-knob resolver (mode → {audio source, trigger}).
  - Turn pagination (prev/next boundaries).
- **Manual smoke** (hardware/permission-dependent, can't be unit-tested): WebRTC connect,
  mic + loopback capture, screenshot injection, voice playback, reconnect on cap.

## 9. Tech stack

- Electron (latest), macOS target.
- OpenAI Realtime API via WebRTC — `@openai/agents-realtime` SDK (or raw WebRTC) with
  `gpt-realtime-2.1`.
- `better-sqlite3` for storage; FTS5 for search.
- ScreenCaptureKit (via Electron loopback APIs) for system audio; `desktopCapturer` for frames.
- `safeStorage` for the API key.

## 10. Open questions / assumptions

- Exact downscale target and JPEG quality to balance vision accuracy vs cost/latency — tune
  during implementation.
- Change-detector threshold and min-interval — tune empirically.
- Whether reconnect-seeding uses a rolling summary or last-N turns — decide in implementation.
- Voice selection (`marin`/`cedar` recommended by OpenAI) — pick a sensible default, expose later.
