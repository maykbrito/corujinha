# Send-screen toggle + region snip — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user send a cropped screen region (fix for small-text legibility) and toggle whether the full screen is attached, defaulting to today's always-full-screen behavior.

**Architecture:** A new full-screen transparent overlay window handles drag-select and returns a rect; the existing capture worker crops to that rect (no downscale). The notch gains a persistent send-screen toggle and a one-shot region attachment chip. `ask()` picks region → full-screen → text-only.

**Tech Stack:** Electron (main + preload + renderers), TypeScript, electron-vite, Vitest (Node/ELECTRON_RUN_AS_NODE), Lucide icons.

**Spec:** `docs/superpowers/specs/2026-07-20-screen-send-toggle-and-region-snip-design.md`

**Testing note:** This repo unit-tests pure Node-side logic only (no renderer DOM tests). TDD applies to config, crop-rect math, and the attachment-decision helper. Overlay/UI/converse are verified via `npm run typecheck` + manual steps.

---

## File Structure

- `src/shared/types.ts` — add `sendScreen` to `ConfigData`, `captureRegion` to `ShortcutMap`. **Modify.**
- `src/main/config/configStore.ts` — defaults for both. **Modify.**
- `src/shared/cropRect.ts` — pure screen→pixel crop math. **Create.**
- `src/shared/ipcChannels.ts` — `CAPTURE_REGION` invoke + `HOTKEY_CAPTURE_REGION` event. **Modify.**
- `src/renderer/captureWorker/main.ts` — optional crop rect on `capture:do`. **Modify.**
- `src/main/screenCapturer.ts` — plumb optional rect through `capture()`. **Modify.**
- `src/main/ipc.ts` — pass rect to capturer; add `capture:region` handler. **Modify.**
- `src/main/windows/selectionOverlay.ts` — new overlay window + `captureRegionRect()`. **Create.**
- `src/renderer/selection/{index.html,main.ts,styles.css}` — overlay UI. **Create.**
- `src/main/shortcuts.ts` — register `captureRegion` shortcut. **Modify.**
- `src/renderer/notch/converse.ts` — `ask()` attachment branching + `decideCapture` helper. **Modify.**
- `src/shared/decideCapture.ts` — pure attachment decision. **Create.**
- `src/renderer/notch/ui.ts` — toggle button + attachment chip refs/markup. **Modify.**
- `src/renderer/notch/styles.css` — toggle + chip styles. **Modify.**
- `src/renderer/notch/main.ts` — toggle state/persist; region shortcut → chip. **Modify.**
- `electron.vite.config.ts` — register the `selection` renderer entry. **Modify.**

---

## Chunk 1: Config + pure logic (TDD)

### Task 1: Config fields

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/config/configStore.ts`
- Test: `tests/main/configStore.test.ts`

- [ ] **Step 1: Write failing tests** — in `tests/main/configStore.test.ts`, add:

```ts
it("defaults sendScreen to true and includes the captureRegion shortcut", () => {
  const store = new ConfigStore(memDisk(null));
  const c = store.get();
  expect(c.sendScreen).toBe(true);
  expect(c.shortcuts.captureRegion).toBe("CommandOrControl+Shift+2");
});

it("persists sendScreen through set", () => {
  const store = new ConfigStore(memDisk(null));
  expect(store.set({ sendScreen: false }).sendScreen).toBe(false);
  expect(store.get().sendScreen).toBe(false);
});
```

(Reuse the file's existing in-memory disk helper; if none, add `function memDisk(seed){let s=seed;return{read:()=>s,write:(v)=>{s=v}}}`.)

- [ ] **Step 2: Run — expect FAIL.** `npm test` → the two new tests fail (`sendScreen` undefined).

- [ ] **Step 3: Implement.** In `types.ts`:
  - `ShortcutMap`: add `captureRegion: string;`
  - `ConfigData`: add `sendScreen: boolean;`
  In `configStore.ts` `DEFAULT_CONFIG`: add `sendScreen: true,` and inside `shortcuts` add `captureRegion: "CommandOrControl+Shift+2",`.

- [ ] **Step 4: Run — expect PASS.** `npm test`.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: config for sendScreen toggle + region shortcut"`

### Task 2: Crop-rect math (pure)

The overlay reports a selection in CSS points on a display with a `scaleFactor`. The captured frame is pixels. We must map the selection to a pixel rect clamped to the frame.

**Files:**
- Create: `src/shared/cropRect.ts`
- Test: `tests/shared/cropRect.test.ts`

- [ ] **Step 1: Write failing test:**

```ts
import { describe, it, expect } from "vitest";
import { toPixelCrop } from "../../src/shared/cropRect";

describe("toPixelCrop", () => {
  it("scales CSS-point selection to frame pixels", () => {
    // 100x50 selection at (10,20) on a 2x display, frame 2x the point size
    const r = toPixelCrop(
      { x: 10, y: 20, w: 100, h: 50 },
      { scaleFactor: 2, pointW: 800, pointH: 600 },
      { frameW: 1600, frameH: 1200 },
    );
    expect(r).toEqual({ x: 20, y: 40, w: 200, h: 100 });
  });

  it("clamps to frame bounds and never returns negative/zero size", () => {
    const r = toPixelCrop(
      { x: -5, y: -5, w: 5000, h: 5000 },
      { scaleFactor: 1, pointW: 1000, pointH: 800 },
      { frameW: 1000, frameH: 800 },
    );
    expect(r).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`toPixelCrop` not defined).

- [ ] **Step 3: Implement `src/shared/cropRect.ts`:**

```ts
// src/shared/cropRect.ts
// Map an overlay selection (CSS points on a display) to a pixel rect inside the
// captured frame. The frame may be scaled differently from points (HiDPI, or the
// captured video is not exactly display-native), so derive scale from frame/point ratio.
export interface Rect { x: number; y: number; w: number; h: number; }
export interface DisplayInfo { scaleFactor: number; pointW: number; pointH: number; }
export interface FrameInfo { frameW: number; frameH: number; }

export function toPixelCrop(sel: Rect, disp: DisplayInfo, frame: FrameInfo): Rect {
  const sx = frame.frameW / disp.pointW; // frame pixels per CSS point (x)
  const sy = frame.frameH / disp.pointH;
  let x = Math.round(sel.x * sx);
  let y = Math.round(sel.y * sy);
  let w = Math.round(sel.w * sx);
  let h = Math.round(sel.h * sy);
  // clamp origin, then size, to the frame
  x = Math.min(Math.max(0, x), frame.frameW);
  y = Math.min(Math.max(0, y), frame.frameH);
  w = Math.min(Math.max(1, w), frame.frameW - x);
  h = Math.min(Math.max(1, h), frame.frameH - y);
  return { x, y, w, h };
}
```

(Note: `scaleFactor` is kept in the interface for callers/debugging; the ratio is derived from frame/point so it stays correct even if capture ≠ native.)

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit.** `git commit -am "feat: toPixelCrop screen->frame crop math"`

### Task 3: Attachment-decision helper (pure)

**Files:**
- Create: `src/shared/decideCapture.ts`
- Test: `tests/shared/decideCapture.test.ts`

- [ ] **Step 1: Failing test:**

```ts
import { describe, it, expect } from "vitest";
import { decideCapture } from "../../src/shared/decideCapture";

describe("decideCapture", () => {
  it("region attachment wins even when toggle is off", () => {
    expect(decideCapture({ hasRegion: true, sendScreen: false })).toBe("region");
  });
  it("full screen when toggle on and no region", () => {
    expect(decideCapture({ hasRegion: false, sendScreen: true })).toBe("full");
  });
  it("text-only when toggle off and no region", () => {
    expect(decideCapture({ hasRegion: false, sendScreen: false })).toBe("none");
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `src/shared/decideCapture.ts`:**

```ts
// src/shared/decideCapture.ts
export type CaptureMode = "region" | "full" | "none";
export function decideCapture(o: { hasRegion: boolean; sendScreen: boolean }): CaptureMode {
  if (o.hasRegion) return "region";
  return o.sendScreen ? "full" : "none";
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit.** `git commit -am "feat: decideCapture attachment-mode helper"`

---

## Chunk 2: Capture pipeline (crop)

### Task 4: Region crop through the capture worker

**Files:**
- Modify: `src/renderer/captureWorker/main.ts`
- Modify: `src/main/screenCapturer.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/shared/ipcChannels.ts`

- [ ] **Step 1: ipcChannels** — under `// capture` add:
```ts
CAPTURE_REGION: "capture:region", // notch -> main: run selection overlay + return cropped image
```
and under `IPC_EVENT` add:
```ts
HOTKEY_CAPTURE_REGION: "hotkey:captureRegion", // main -> notch: start region snip
```

- [ ] **Step 2: captureWorker/main.ts** — accept an optional crop rect. Change the listener + `captureOnce` so that when a rect is present it crops at native resolution (skip the 1920 clamp) using `toPixelCrop`:

```ts
import { toPixelCrop, type Rect } from "@shared/cropRect";
// ...
async function captureOnce(crop?: { rect: Rect; disp: { scaleFactor:number; pointW:number; pointH:number } }, maxWidth = 1920, quality = 0.92): Promise<string> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { width:{ideal:3840}, height:{ideal:2160}, frameRate:1 }, audio:false });
  try {
    const video = document.createElement("video");
    video.srcObject = stream; await video.play(); await waitForDimensions(video);
    const vw = video.videoWidth, vh = video.videoHeight;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    if (crop) {
      const px = toPixelCrop(crop.rect, crop.disp, { frameW: vw, frameH: vh });
      canvas.width = px.w; canvas.height = px.h;
      ctx.drawImage(video, px.x, px.y, px.w, px.h, 0, 0, px.w, px.h);
      return canvas.toDataURL("image/jpeg", 0.95); // small region → higher quality
    }
    const scale = Math.min(1, maxWidth / vw);
    canvas.width = Math.round(vw*scale); canvas.height = Math.round(vh*scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally { stream.getTracks().forEach(t => t.stop()); }
}

api.on("capture:do", async (requestId: string, crop?: any) => {
  try { api.invoke("capture:result", requestId, { ok: true, dataUrl: await captureOnce(crop) }); }
  catch (e) { api.invoke("capture:result", requestId, { ok: false, error: String(e) }); }
});
```

- [ ] **Step 3: screenCapturer.ts** — `capture(crop?)` forwards the crop payload to the worker send:
```ts
capture(crop?: unknown): Promise<{ dataUrl: string; thumbPath: string }> {
  // ...unchanged pending/timeout...
  this.ready.then(() => this.worker.webContents.send("capture:do", id, crop));
}
```

- [ ] **Step 4: Verify build.** `npm run typecheck` → expect PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat: crop path in capture worker + screenCapturer"`

---

## Chunk 3: Selection overlay window

### Task 5: Overlay renderer

**Files:**
- Create: `src/renderer/selection/index.html`
- Create: `src/renderer/selection/main.ts`
- Create: `src/renderer/selection/styles.css`
- Modify: `electron.vite.config.ts` (add `selection/index.html` to renderer inputs — mirror the existing notch/captureWorker entries)

- [ ] **Step 1: index.html** — mirror `captureWorker`/`notch` html: load `./styles.css` and `./main.ts`, a single `<div id="sel"></div>`.

- [ ] **Step 2: styles.css** — overlay "A": full-viewport, `cursor:crosshair`; `#sel` selection box uses `box-shadow: 0 0 0 9999px rgba(0,0,0,.55)` for the dim-outside effect, `2px solid #6cccff` border; a `.dims` label and a `.hint` "arraste · ESC cancela". (Colors from the notch theme.)

- [ ] **Step 3: main.ts** — drag to draw the rect; on `mouseup` send the selection (CSS points + display info) and close; `Escape` cancels:
```ts
const api = (window as any).api;
// display info is injected by the main process via query string or a config:get-like call.
let start: {x:number;y:number} | null = null;
const box = document.getElementById("sel")!;
addEventListener("mousedown", (e) => { start = { x:e.clientX, y:e.clientY }; });
addEventListener("mousemove", (e) => { if (!start) return; drawBox(start, e); });
addEventListener("mouseup", (e) => {
  if (!start) return;
  const r = normRect(start, { x:e.clientX, y:e.clientY });
  start = null;
  if (r.w < 4 || r.h < 4) return api.invoke("selection:cancel");
  api.invoke("selection:done", r);
});
addEventListener("keydown", (e) => { if (e.key === "Escape") api.invoke("selection:cancel"); });
```
(Helpers `drawBox`, `normRect` update `#sel` position/size and the `.dims` label. `r` is `{x,y,w,h}` in CSS points relative to the overlay = the display work area.)

- [ ] **Step 4: Verify build.** `npm run typecheck`.
- [ ] **Step 5: Commit.** `git commit -am "feat: selection overlay renderer (drag-select + esc)"`

### Task 6: Overlay window + orchestration in main

**Files:**
- Create: `src/main/windows/selectionOverlay.ts`
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: selectionOverlay.ts** — open a transparent, frameless, always-on-top window covering the primary display's `bounds`, resolve with the selected rect or `null` on cancel. Register one-shot `selection:done` / `selection:cancel` handlers scoped to this call:
```ts
import { BrowserWindow, screen, ipcMain } from "electron";
import { join } from "path";
import type { Rect } from "@shared/cropRect";

export function captureRegionRect(): Promise<{ rect: Rect; disp: { scaleFactor:number; pointW:number; pointH:number } } | null> {
  const d = screen.getPrimaryDisplay();
  const { x, y, width, height } = d.bounds;
  const win = new BrowserWindow({
    x, y, width, height, frame:false, transparent:true, hasShadow:false, resizable:false,
    movable:false, skipTaskbar:true, alwaysOnTop:true, fullscreenable:false, enableLargerThanScreen:true,
    webPreferences: { preload: join(__dirname, "../preload/index.js") },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (process.env["ELECTRON_RENDERER_URL"]) win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/selection/index.html`);
  else win.loadFile(join(__dirname, "../renderer/selection/index.html"));
  win.focus();

  return new Promise((resolve) => {
    const cleanup = () => { ipcMain.removeHandler("selection:done"); ipcMain.removeHandler("selection:cancel"); if (!win.isDestroyed()) win.close(); };
    ipcMain.handle("selection:done", (_e, rect: Rect) => {
      cleanup();
      resolve({ rect, disp: { scaleFactor: d.scaleFactor, pointW: width, pointH: height } });
    });
    ipcMain.handle("selection:cancel", () => { cleanup(); resolve(null); });
    win.on("closed", () => { ipcMain.removeHandler("selection:done"); ipcMain.removeHandler("selection:cancel"); resolve(null); });
  });
}
```
(ponytail: primary display only for v1 — multi-monitor is a follow-up; note it with a `ponytail:` comment.)

- [ ] **Step 2: ipc.ts** — add the `capture:region` handler that runs the overlay then crops:
```ts
import { captureRegionRect } from "./windows/selectionOverlay";
// ...
ipcMain.handle(IPC.CAPTURE_REGION, async () => {
  const sel = await captureRegionRect();
  if (!sel) return null; // canceled
  return deps.capturer.capture(sel); // { dataUrl, thumbPath }
});
```

- [ ] **Step 3: Verify build.** `npm run typecheck`.
- [ ] **Step 4: Manual smoke** — temporarily bind a devtools call or reuse Task 8's shortcut later; defer full manual test to Task 9.
- [ ] **Step 5: Commit.** `git commit -am "feat: selection overlay window + capture:region orchestration"`

---

## Chunk 4: Wiring + notch UI

### Task 7: Register the region shortcut

**Files:**
- Modify: `src/main/shortcuts.ts`

- [ ] **Step 1:** In `applyShortcuts()`, after the existing `reg(...)` calls, add:
```ts
reg(s.captureRegion, () => d.sendToNotch(IPC_EVENT.HOTKEY_CAPTURE_REGION));
```
- [ ] **Step 2: Verify build.** `npm run typecheck`.
- [ ] **Step 3: Commit.** `git commit -am "feat: register captureRegion global shortcut"`

### Task 8: Notch toggle button (visual C v2)

**Files:**
- Modify: `src/renderer/notch/ui.ts`
- Modify: `src/renderer/notch/styles.css`
- Modify: `src/renderer/notch/main.ts`

- [ ] **Step 1: ui.ts markup** — in `.notch-typebox`, before `<input id="msg">`, add:
```html
<button id="screenToggle" class="notch-screen-toggle" title="Send screen"></button>
```
Add `screenToggle: HTMLButtonElement` and `attach`/`chip` refs (Task 9) to `NotchRefs` and `$(...)`. Import `Monitor`, `MonitorOff` from `lucide`. Add a `setScreenToggle(refs, on)` exported helper that swaps the icon and toggles a `.on` class (the green dot is a CSS `::after`).

- [ ] **Step 2: styles.css** — add:
```css
.notch-screen-toggle { position:relative; display:flex; align-items:center; justify-content:center; width:30px; border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.06); border-radius:8px; color:#888; }
.notch-screen-toggle svg { width:15px; height:15px; }
.notch-screen-toggle.on { color:#eee; }
.notch-screen-toggle.on::after { content:""; position:absolute; right:5px; bottom:5px; width:6px; height:6px; border-radius:50%; background:#3ddc6d; box-shadow:0 0 5px #3ddc6d; border:1px solid #000; }
```

- [ ] **Step 3: main.ts state** — add `let sendScreen = true;`. On startup `config:get`, set `sendScreen = c.sendScreen ?? true; setScreenToggle(refs, sendScreen);`. Wire click:
```ts
refs.screenToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  sendScreen = !sendScreen;
  setScreenToggle(refs, sendScreen);
  api.invoke("config:set", { sendScreen });
});
```
Add `screenToggle` to `initTooltips([...])`.

- [ ] **Step 4: Verify build.** `npm run typecheck`.
- [ ] **Step 5: Commit.** `git commit -am "feat: notch send-screen toggle button"`

### Task 9: Attachment chip + region one-shot + ask() branching

**Files:**
- Modify: `src/renderer/notch/ui.ts`
- Modify: `src/renderer/notch/styles.css`
- Modify: `src/renderer/notch/main.ts`
- Modify: `src/renderer/notch/converse.ts`

- [ ] **Step 1: ui.ts** — add an attachment slot in `.notch-typebox` (before input): `<div id="attach" class="notch-attach" hidden></div>`. Add `attachEl: HTMLElement` to refs. Add exported `renderAttach(refs, region)` that fills a thumbnail (`<img src=dataUrl>` scaled 34×24) + `WxH` label + a `×` button; `hidden` when `region` is null.

- [ ] **Step 2: styles.css** — chip styles (reuse the mockup: cyan-tinted border, small thumb, round × ). 

- [ ] **Step 3: converse.ts** — change `ask` to take the current send options and use `decideCapture`:
```ts
import { decideCapture } from "@shared/decideCapture";
// region?: { dataUrl:string; thumbPath:string }
async function ask(text: string, opts: { sendScreen: boolean; region?: { dataUrl:string; thumbPath:string } | null }): Promise<boolean> {
  // ...trim, onUserText, addTurn (unchanged)...
  let imageDataUrl: string | undefined;
  const mode = decideCapture({ hasRegion: !!opts.region, sendScreen: opts.sendScreen });
  try {
    if (mode === "region" && opts.region) {
      await api.invoke("history:addCapture", { sessionId, turnId:null, thumbPath: opts.region.thumbPath, summary: q });
      imageDataUrl = opts.region.dataUrl;
    } else if (mode === "full") {
      const shot = await api.invoke("capture:screen");
      await api.invoke("history:addCapture", { sessionId, turnId:null, thumbPath: shot.thumbPath, summary: q });
      imageDataUrl = shot.dataUrl;
    } // mode === "none" -> text only
  } catch { hooks.onStatus("capture-failed"); }
  // ...rest unchanged (build messages with imageDataUrl on the last turn)...
}
```
Update the returned `ask` signature and `askNow` (askNow forces full screen: pass `{ sendScreen: true }`).

- [ ] **Step 4: main.ts** — hold `let pendingRegion: {dataUrl:string;thumbPath:string} | null = null;`. Handle the shortcut:
```ts
api.on("hotkey:captureRegion", async () => {
  const shot = await api.invoke("capture:region"); // { dataUrl, thumbPath } | null
  if (!shot) return;              // canceled
  pendingRegion = shot;
  if (morph === "collapsed") expand();
  renderAttach(refs, { dataUrl: shot.dataUrl, w: 0, h: 0 }); // dims optional; show thumb
  refs.input.focus();
});
```
Update `actions.send`:
```ts
async send(text) {
  try {
    const ok = await (await ensureConverse()).ask(text, { sendScreen, region: pendingRegion });
    if (ok) { pendingRegion = null; renderAttach(refs, null); }
    return ok;
  } catch { return false; }
}
```
Wire the chip `×` (in `renderAttach`) to clear `pendingRegion` + `renderAttach(refs, null)`.

- [ ] **Step 5: Verify build + tests.** `npm run typecheck` && `npm test` (pure tests still green).
- [ ] **Step 6: Commit.** `git commit -am "feat: region attachment chip + ask() attachment branching"`

---

## Chunk 5: Verify end-to-end

### Task 10: Manual verification + dist

- [ ] **Step 1:** `npm run dev`. Confirm:
  - Toggle shows green dot when on; off → icon dims; state persists across restart (`config.json`).
  - `Cmd+Shift+2` dims the screen; drag selects; **ESC cancels** with no attachment; tiny selection (<4px) cancels.
  - After select, chip appears with thumbnail; `×` removes it.
  - Type a question → Send: region travels with that message; chip clears; next message reverts to toggle state.
  - Toggle off + Send → text-only (no capture).
  - Ask a question about a cropped region of **small text** and confirm the model reads it correctly (the core goal).
- [ ] **Step 2:** `npm run typecheck && npm test` → all green.
- [ ] **Step 3:** `npm run dist`; install the fresh DMG; smoke-test the shortcut + toggle in the packaged app.
- [ ] **Step 4: Commit** any fixes found during verification.

---

## Open items (resolve during implementation)

- **Multi-monitor:** v1 covers the primary display only (`ponytail:` comment in `selectionOverlay.ts`). Follow-up: pick the display under the cursor and offset coordinates.
- **Crop encoding:** JPEG 0.95 chosen for the region; revisit PNG if colored small text still reads poorly (the frame is already small).
- **`getDisplayMedia` ownership:** the crop reuses the existing capture worker (single owner of screen capture), keeping one permission path.
