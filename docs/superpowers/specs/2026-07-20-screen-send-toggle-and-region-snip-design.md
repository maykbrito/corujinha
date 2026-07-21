# Design: Send-screen toggle + region snip

Date: 2026-07-20
Status: Approved (design), pending implementation plan

## Problem

Corujinha reads the screen to answer questions, but **small on-screen text
(code, numbers) comes back misread**. Root cause verified against primary
sources: the Gemma vision encoder (SigLIP) runs at a **fixed 896×896**, and
Ollama/llama.cpp **resize the whole image to 896×896** before the model reads
it (pan & scan tiling is not enabled in these runtimes). So a full-screen
capture — even at 4K — is squashed to ~896px and a 16:9 screen is also
aspect-distorted. Raising screenshot resolution or switching to PNG barely
helps because the 896² encoder is a hard ceiling.

**The only real lever is sending less area.** A cropped region gets the full
896² budget, so its text stays legible.

Today every "Send" auto-captures the full screen unconditionally
(`converse.ts` `ask()` → `capture:screen`). There is no way to send a region,
and no way to send text-only.

## Goals

1. Let the user send a **selected region** instead of the whole screen — the
   fix for small-text legibility.
2. Let the user **toggle** whether the full screen is attached at all
   (privacy / token control), defaulting to today's behavior.

Non-goals: client-side pan & scan / tiling (whole-screen + detail); changing
the model; native double-tap-modifier shortcuts.

## Design

### Attachment model (three states per message)

- **Text only** — no image.
- **Full screen** — current behavior.
- **Region** — a user-selected crop.

Two controls drive these:

- **Send-screen toggle** (persistent) switches Text-only ↔ Full-screen.
- **Region snip** (shortcut) produces a **one-shot** region attachment that
  takes priority for that single message, then reverts to the toggle state.

### 1. Send-screen toggle

- A monitor icon button at the far left of `.notch-typebox`, before the input.
- **On:** monitor icon, normal color, small green "live" dot at bottom-right.
  **Off:** monitor-with-slash icon, dimmed. (Chosen visual: option "C v2".)
- Persisted as `sendScreen: boolean` in config, **default `true`** (preserves
  current behavior; the toggle exists to turn capture *off*).
- `ask()` branches: region present → send crop; else `sendScreen` → full
  screen; else text-only.

### 2. Region snip

- Global shortcut **`CommandOrControl+Shift+2`** (configurable in Settings like
  the existing shortcuts).
- On trigger: reveal/focus the notch, then open a **full-screen selection
  overlay**: dim outside the selection, crisp selection with a cyan border, a
  live dimensions label, and a "arraste · ESC cancela" hint. **ESC cancels.**
- On drag-release: capture **only that region at native resolution** (no
  downscale). Encode lossless/high-quality since the area is small and text is
  the point.
- The crop becomes a **one-shot attachment chip** in the input (thumbnail + ×
  to remove). The user types the question and presses Send; the crop travels
  with that one message. After send (or ×), the attachment clears and behavior
  reverts to the toggle state.
- Region attachment has **priority over the toggle** for that message (sends
  even when the toggle is off).

### Why cropping fixes it

Any image is squashed to 896² by the model. A whole 16:9 screen loses most of
its detail; a small cropped region maps close to 1:1 into 896², keeping text
readable.

## Components / where code changes

- **`src/main/config/configStore.ts`** — add `sendScreen: boolean` (default
  `true`) and a `captureRegion` shortcut entry
  (`"CommandOrControl+Shift+2"`).
- **`src/main/shortcuts.ts`** — register `captureRegion`; on fire, tell the
  notch to start region capture (new IPC event, mirroring `HOTKEY_ASK_NOW`).
- **Selection overlay window (new component)** — a transparent, full-screen
  `BrowserWindow` that renders overlay "A", handles the drag-select and ESC,
  and returns the selected rect (screen coordinates) over IPC. This is the
  heaviest new piece: a new window, mouse-drag capture, and multi-monitor
  geometry. It closes on select or cancel.
- **`src/renderer/captureWorker/main.ts`** — add a region-crop path: given a
  rect, crop the captured frame to it and encode without the 1920 downscale.
  Keep the existing full-screen path for the toggle.
- **`src/main/screenCapturer.ts`** — plumb an optional rect through
  `capture()` to the worker.
- **`src/renderer/notch/`** (`ui.ts`, `main.ts`, `styles.css`, `converse.ts`)
  — toggle button + persisted state; attachment-chip rendering + one-shot
  region state; `ask()` decides region / full-screen / text-only.

## Data flow

Region: shortcut → main → notch (start capture) → overlay window (drag → rect)
→ main → capture worker (crop rect, encode) → notch (attachment chip) → user
types → Send → `ask()` sends crop with the message → clear.

Full screen / text-only: Send → `ask()` reads `sendScreen`; if on, existing
`capture:screen`; if off, no image.

## Error handling

- Overlay canceled (ESC) or zero-size selection → no attachment, no message
  sent, notch returns to idle.
- Capture/crop failure → surface as the existing `capture-failed` status; for
  region, do not send a broken attachment.
- Screen Recording permission missing → the existing empty-sources path
  applies; the overlay should still cancel cleanly.

## Testing

- Unit: `ask()` selects the correct attachment mode across
  {region, toggle-on, toggle-off}; `sendScreen` persists through
  config get/set; crop-rect math (screen→image coordinates, including scale)
  is correct.
- Manual: shortcut opens overlay; drag selects; ESC cancels; chip appears and
  can be removed; small text in a cropped region is read correctly by the
  model; toggle off sends text-only.

## Open items for the plan

- Exact ownership of `getDisplayMedia` for the crop (overlay window vs existing
  capture worker) and how the rect maps to captured-frame pixels.
- Multi-monitor: which display the overlay covers and coordinate origin.
- Crop encoding format (PNG vs JPEG ~0.95) — decide during implementation.
