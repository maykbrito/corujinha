# See-and-Talk Local (Ollama) — Phase B Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the notch as a Cody-style morphing pill: a small always-on-top pill that expands into a draggable, resizable, opacity-adjustable panel, showing the turn-based Q&A (text field + Send + response + prev/next pagination) built in Phase A. Behavior copies Cody.app; content is our own.

**Architecture:** The main process owns the frameless/transparent panel window and a small IPC surface for move/resize/position/pinned/click-through. The renderer owns a morph state machine (collapsed↔expanded), drag-with-snap, edge resize, an opacity slider that tints the surface via a CSS variable, hover-reveal of controls, and click-through toggling when the pointer leaves the shape. Pure geometry (size/opacity clamps, snap distance, notch bounds) is extracted into a tested module. The Phase A turn pipeline (`startConverse`/`ask`) is reused unchanged.

### Window/morph model (pin this — resolves the click-through dead-zone)

Matches Cody's macOS path exactly:

- The OS window is sized to the **expanded panel** (`DEFAULT_W × DEFAULT_H`), NOT `MAX_H`. Expand/collapse is a **CSS morph of the `.notch-shape` inside the window** — the OS window is NOT resized on collapse. Resize (edge handles) DOES resize the OS window to the new panel size via `notch:resize`.
- **Click-through is the default** (`setIgnoreMouseEvents(true,{forward:true})` at creation). The renderer DISABLES it on `mouseenter`/pointer-inside `.notch-shape` and RE-ENABLES it on `mouseleave` (when not dragging/resizing) — port Cody notch-bubble.html:2800-2811. So the transparent region around the collapsed pill (and around the panel) always forwards clicks to whatever is beneath.
- **Dead-zone guard:** a fast pointer exit can skip `mouseleave`, leaving click-through disabled over the transparent remainder. If the smoke test (Task 8 step below) reveals this, add Cody's main-process cursor poll as a fallback (`syncNotchMouseEventsWithCursor`, notchBubble.js:141-155) that re-asserts click-through when the cursor sits outside the visible shape rect. Start WITHOUT the poll (YAGNI); add only if the dead-zone appears.

**Tech Stack:** Electron, TypeScript, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-16-see-and-talk-local-ollama-design.md` (§4.3)
**Cody reference (vendored):** `docs/superpowers/reference/cody/` — `notchBubble.js`, `notch-bubble.html`, `notchBubblePreload.src.js`, `appWindowOpacityController.js`. Port the *interaction* code; DROP everything about insights/follow-ups/notch-modes/response-language/font-scale/capture-indicator/surface-theme/Windows-`setShape`/standalone-preview.

---

## What we copy vs. drop (read before starting)

**Copy (from Cody):**
- Window flags + top-center positioning + `screen-saver` level + visible-on-all-workspaces (notchBubble.js:280-331).
- Pill(300×34)↔panel morph with the spring/ease transitions and inner-content fade (notch-bubble.html CSS `.notch-shape`, `.notch-inner`, `.collapsing`).
- Drag-from-header with 4px threshold, per-frame throttle, snap-back within 150px → pinned else floating (notch-bubble.html:1690-1796).
- Edge resize (right = width, bottom = height) with clamps + localStorage persistence (notch-bubble.html:1798-1882, `sanitizeNotchSize`).
- Opacity slider 0.45–1.0 tinting `--notch-background-opacity`, localStorage-persisted (notch-bubble.html `applyNotchOpacity`, `transparencySlider`).
- Hover-reveal of controls; click-through via `setIgnoreMouseEvents(true,{forward:true})` toggled on pointer enter/leave (notch-bubble.html:2778-2811, preload `setIgnoreMouseEvents`).
- Collapse/expand state machine `collapsed|expanding|expanded|collapsing` (notch-bubble.html:2492-2555).
- `renderMarkdown` + `renderInline` + `escapeHtml` (notch-bubble.html:2813-3025) — for rendering assistant replies. Drop the code-language-label feature (`flavorFeatures.fastFirstInsight` branch) — always pass plain fences.

**Drop (not requested):** insight history streaming, follow-ups, notch modes, response-language select, font-scale buttons, capture-indicator sweep, surface-theme toggle, Windows `setShape`/native-shape code, `renderStandalonePreview`, brand icon, refresh button.

**Adapt:** the panel's inner content is NOT Cody's insight scroller — it's our Phase A UI: status line, current turn (role + rendered markdown text), prev/next pagination + counter, text input + Send. The gear opens a settings sub-panel containing ONLY the opacity slider (URL/model stay in the separate Settings window from Phase A).

---

## File Structure

**New:**
- `src/shared/notchGeometry.ts` — pure: `clampSize`, `clampOpacity`, `snapDistance`, `notchBounds`, `NOTCH` constants. Imported by BOTH the main IPC controller and the renderer drag/resize (no Electron imports, so it's renderer-safe). Tested.
- `src/main/windows/notchWindowController.ts` — registers the notch window-control IPC (move/resize/get-position/get-notch-position/set-pinned/set-ignore-mouse), holds pinned state + current size.
- `tests/shared/notchGeometry.test.ts`.
- `src/shared/notchMarkdown.ts` — pure `renderMarkdown(text)` (ported, stripped). Tested.
- `tests/shared/notchMarkdown.test.ts`.

**Modified:**
- `src/main/windows/notchWindow.ts` — Cody-style flags + positioning; expose helpers used by the controller.
- `src/shared/ipcChannels.ts` — add notch window-control channels.
- `src/preload/index.ts` — already a generic passthrough; no change needed (verify).
- `src/main/index.ts` — register the notch window controller; end active session on quit.
- `src/main/ipc.ts` — none (window control lives in its own controller) OR register controller here; see Task.
- `src/renderer/notch/index.html` — morph-shape structure.
- `src/renderer/notch/styles.css` — morph/pill/panel/hover-reveal/opacity CSS.
- `src/renderer/notch/ui.ts` — build the morph shape DOM + render turn (markdown) + pagination + opacity slider.
- `src/renderer/notch/main.ts` — morph state machine + drag + resize + opacity + click-through, wired to Phase A `startConverse`.
- `src/renderer/notch/realtime.ts` — expose `endSession` already present as `stop()`; call it on quit.

---

## Chunk 1: Main-process window, geometry, IPC

### Task 1: Pure geometry module

**Files:**
- Create: `src/shared/notchGeometry.ts`
- Test: `tests/shared/notchGeometry.test.ts`

Constants mirror Cody: collapsed pill 300×34; expanded default 436×212; min 360×160; max 900×640; opacity 0.45–1.0; snap 150px. Lives in `src/shared/` so both the main IPC controller and the renderer drag/resize import the same source (it has no Electron imports).

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/notchGeometry.test.ts
import { describe, it, expect } from "vitest";
import { clampSize, clampOpacity, snapDistance, notchBounds, NOTCH } from "../../src/shared/notchGeometry";

describe("notchGeometry", () => {
  it("clamps size within min/max", () => {
    expect(clampSize({ width: 10, height: 10 })).toEqual({ width: NOTCH.MIN_W, height: NOTCH.MIN_H });
    expect(clampSize({ width: 9999, height: 9999 })).toEqual({ width: NOTCH.MAX_W, height: NOTCH.MAX_H });
    expect(clampSize({ width: 500, height: 300 })).toEqual({ width: 500, height: 300 });
  });
  it("clamps opacity within 0.45..1", () => {
    expect(clampOpacity(0)).toBe(0.45);
    expect(clampOpacity(2)).toBe(1);
    expect(clampOpacity(0.7)).toBe(0.7);
  });
  it("computes euclidean snap distance", () => {
    expect(snapDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
  it("centers the pill at the top of the work area", () => {
    const b = notchBounds({ x: 0, y: 0, width: 1440, height: 900 }, 300);
    expect(b).toEqual({ x: Math.round(720 - 150), y: 0, width: 300, height: NOTCH.COLLAPSED_H });
  });
  it("recenters a pinned panel on resize (x tracks the new width)", () => {
    // The controller centers a pinned window: x = area.x + (area.width - width)/2
    const area = { x: 0, y: 0, width: 1440, height: 900 };
    const b = notchBounds(area, 600);
    expect(b.x).toBe(Math.round((1440 - 600) / 2)); // 420
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/usr/local/bin/node ./node_modules/vitest/vitest.mjs run tests/shared/notchGeometry.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/notchGeometry.ts
export const NOTCH = {
  COLLAPSED_W: 300,
  COLLAPSED_H: 34,
  DEFAULT_W: 436,
  DEFAULT_H: 212,
  MIN_W: 360,
  MIN_H: 160,
  MAX_W: 900,
  MAX_H: 640,
  MIN_OPACITY: 0.45,
  MAX_OPACITY: 1,
  SNAP_PX: 150,
} as const;

export interface Size { width: number; height: number; }
export interface Point { x: number; y: number; }
export interface Rect { x: number; y: number; width: number; height: number; }

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function clampSize(s: Size): Size {
  return {
    width: clamp(Math.round(s.width), NOTCH.MIN_W, NOTCH.MAX_W),
    height: clamp(Math.round(s.height), NOTCH.MIN_H, NOTCH.MAX_H),
  };
}
export function clampOpacity(v: number): number {
  return clamp(Math.round(v * 100) / 100, NOTCH.MIN_OPACITY, NOTCH.MAX_OPACITY);
}
export function snapDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
// Center a `width`-wide shape at the top of the given display work area.
export function notchBounds(area: Rect, width: number): Rect {
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y,
    width,
    height: NOTCH.COLLAPSED_H,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/usr/local/bin/node ./node_modules/vitest/vitest.mjs run tests/shared/notchGeometry.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/notchGeometry.ts tests/shared/notchGeometry.test.ts
git commit -m "feat: pure notch geometry (size/opacity clamps, snap, bounds)"
```

### Task 2: Notch window-control IPC channels

**Files:**
- Modify: `src/shared/ipcChannels.ts`

- [ ] **Step 1: Add channels** to `IPC` (after `NOTCH_SET_FOCUSABLE`):

> `NOTCH_SET_FOCUSABLE` stays defined but is **unused** (the window is `focusable:true` for the text field, consistent with Phase A). Leave it as a no-op channel or wire a future focus toggle; do not remove it in Phase B.

```ts
  // notch window control (Cody-style morph/drag/resize)
  NOTCH_SET_FOCUSABLE: "notch:setFocusable",
  NOTCH_MOVE: "notch:move",
  NOTCH_RESIZE: "notch:resize",
  NOTCH_GET_POSITION: "notch:getPosition",
  NOTCH_GET_NOTCH_POSITION: "notch:getNotchPosition",
  NOTCH_SET_PINNED: "notch:setPinned",
  NOTCH_SET_IGNORE_MOUSE: "notch:setIgnoreMouse",
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (adding constants breaks nothing).

- [ ] **Step 3: Commit**

```bash
git add src/shared/ipcChannels.ts
git commit -m "feat: notch window-control IPC channels"
```

### Task 3: Notch window (Cody-style) + controller

**Files:**
- Modify: `src/main/windows/notchWindow.ts`
- Create: `src/main/windows/notchWindowController.ts`
- Modify: `src/main/index.ts` (register controller)

Reference: `docs/superpowers/reference/cody/notchBubble.js:280-331` (flags) and `:617-659` (move/resize/position/pinned handlers).

- [ ] **Step 1: Rewrite `notchWindow.ts`**

```ts
// src/main/windows/notchWindow.ts
import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { NOTCH, notchBounds } from "@shared/notchGeometry";

// Cody-style: the window starts pill-sized at top-center. The renderer morphs the visible
// shape inside it and asks main to resize/move the OS window as it expands/drags.
export function createNotchWindow(): BrowserWindow {
  const area = screen.getPrimaryDisplay().workArea;
  const b = notchBounds(area, NOTCH.DEFAULT_W); // window is DEFAULT_W wide; pill is centered via CSS
  const win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: NOTCH.DEFAULT_W,
    height: NOTCH.DEFAULT_H, // window == expanded-panel size; the pill is CSS-morphed inside it (see Window/morph model)
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false, // we do custom edge-resize in the renderer
    movable: false,   // we move via IPC during drag
    focusable: true,  // text field needs keyboard; only activates on click
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    roundedCorners: false,
    type: process.platform === "darwin" ? "panel" : undefined,
    webPreferences: { preload: join(__dirname, "../preload/index.js") },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Start click-through; the renderer disables it while the pointer is inside the shape.
  win.setIgnoreMouseEvents(true, { forward: true });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/notch/index.html`);
  } else {
    win.loadFile(join(__dirname, "../renderer/notch/index.html"));
  }
  return win;
}
```

Note the change from `"floating"` to `"screen-saver"` matches Cody (floats above the menu bar). This works because the window is **click-through by default** over the menu-bar region: the centered ~436px window overlaps only the physical-notch center of the menu bar (no items there), while tray icons sit top-right outside it — so the menu bar and tray stay clickable. Verify in the Task 8 smoke.

- [ ] **Step 2: Create `notchWindowController.ts`**

```ts
// src/main/windows/notchWindowController.ts
import { ipcMain, BrowserWindow, screen } from "electron";
import { IPC } from "@shared/ipcChannels";
import { NOTCH, notchBounds, clampSize } from "@shared/notchGeometry";

// Owns the notch window's live pinned state + geometry helpers. The renderer drives
// drag/resize; main applies the moves/resizes and answers position queries.
export function registerNotchWindowControl(getNotch: () => BrowserWindow | null): void {
  let pinned = true;

  const notchOrigin = () => {
    const area = screen.getPrimaryDisplay().workArea;
    const b = notchBounds(area, NOTCH.DEFAULT_W);
    return { x: b.x, y: b.y };
  };

  // NOTE: the preload exposes only `invoke`, so EVERY channel below must be `ipcMain.handle`
  // (invoke↔handle). `ipcMain.on` would silently never fire — leaving the window permanently
  // click-through and un-draggable/un-resizable.
  ipcMain.handle(IPC.NOTCH_MOVE, (_e, x: number, y: number) => {
    const win = getNotch();
    if (win && !win.isDestroyed() && Number.isFinite(x) && Number.isFinite(y)) {
      win.setPosition(Math.round(x), Math.round(y));
    }
  });

  ipcMain.handle(IPC.NOTCH_RESIZE, (_e, width: number, height: number) => {
    const win = getNotch();
    if (!win || win.isDestroyed()) return;
    const size = clampSize({ width, height });
    const cur = win.getBounds();
    if (pinned) {
      const area = screen.getPrimaryDisplay().workArea;
      win.setBounds({ x: area.x + Math.round((area.width - size.width) / 2), y: area.y, width: size.width, height: size.height });
    } else {
      win.setBounds({ x: cur.x, y: cur.y, width: size.width, height: size.height });
    }
  });

  ipcMain.handle(IPC.NOTCH_GET_POSITION, () => {
    const win = getNotch();
    if (!win || win.isDestroyed()) return null;
    const [x, y] = win.getPosition();
    return { x, y };
  });

  ipcMain.handle(IPC.NOTCH_GET_NOTCH_POSITION, () => notchOrigin());

  ipcMain.handle(IPC.NOTCH_SET_PINNED, (_e, p: boolean) => { pinned = !!p; });

  ipcMain.handle(IPC.NOTCH_SET_IGNORE_MOUSE, (_e, ignore: boolean, options?: { forward?: boolean }) => {
    const win = getNotch();
    if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!!ignore, options || {});
  });
}
```

- [ ] **Step 3: Wire in `main/index.ts`** — import and call `registerNotchWindowControl(() => notch)` after `notch = createNotchWindow();`, and end any active DB session **directly in main** on quit (synchronous `better-sqlite3`, no renderer round-trip — the app can exit before an async IPC hop completes). Add:

```ts
import { registerNotchWindowControl } from "./windows/notchWindowController";
```
After `registerIpc({ ... })`:
```ts
  registerNotchWindowControl(() => notch);
```
Replace the `will-quit` handler (keep `unregisterShortcuts()`):
```ts
app.on("will-quit", () => {
  unregisterShortcuts();
  history.endActiveSessions(); // close any active session synchronously before exit
});
```
(`history` is already in scope in `whenReady`; if the handler is registered outside that scope, hoist a module-level `let history` set in `whenReady`.)

- [ ] **Step 3b: Add `HistoryStore.endActiveSessions()`** in `src/main/history/historyStore.ts` (next to `endSession`):

```ts
  endActiveSessions(): void {
    this.db.prepare("UPDATE sessions SET status='ended', ended_at=? WHERE status='active'").run(Date.now());
  }
```

This makes "sessions end on quit" reliable and removes the need for any `notch:endSession` renderer message.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/windows/notchWindow.ts src/main/windows/notchWindowController.ts src/main/index.ts src/main/history/historyStore.ts
git commit -m "feat: Cody-style notch window + drag/resize/position IPC controller + end-active-sessions on quit"
```

---

## Chunk 2: Notch markdown + HTML/CSS

### Task 4: Markdown renderer (ported, stripped)

**Files:**
- Create: `src/shared/notchMarkdown.ts`
- Test: `tests/shared/notchMarkdown.test.ts`

Port `escapeHtml`, `renderInline`, `renderMarkdown` from `docs/superpowers/reference/cody/notch-bubble.html:2813-3025`. DROP the `flavorFeatures.fastFirstInsight` code-language branch (always render plain `<pre><code>`), DROP `renderAllowedInlineHtml` (the green-span feature). Keep: bold, italic, inline code, fenced code blocks, ul/ol, h1-3, blockquote, paragraphs.

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/notchMarkdown.test.ts
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../../src/shared/notchMarkdown";

describe("renderMarkdown", () => {
  it("escapes html", () => {
    expect(renderMarkdown("<script>")).toContain("&lt;script&gt;");
  });
  it("renders bold, italic, inline code", () => {
    expect(renderMarkdown("**b** *i* `c`")).toContain("<strong>b</strong>");
    expect(renderMarkdown("**b** *i* `c`")).toContain("<em>i</em>");
    expect(renderMarkdown("**b** *i* `c`")).toContain("<code>c</code>");
  });
  it("renders an unordered list", () => {
    const out = renderMarkdown("- one\n- two");
    expect(out).toContain("<ul>");
    expect(out).toContain("<li>one</li>");
  });
  it("renders a fenced code block, escaping its contents", () => {
    const out = renderMarkdown("```\n<b> & 'x'\n```");
    expect(out).toContain("<pre><code>");
    expect(out).toContain("&lt;b&gt;");
  });
  it("renders headings and paragraphs", () => {
    expect(renderMarkdown("# Title")).toContain("<h1>Title</h1>");
    expect(renderMarkdown("hello")).toContain("<p>hello</p>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/usr/local/bin/node ./node_modules/vitest/vitest.mjs run tests/shared/notchMarkdown.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — port from the vendored Cody file. Full adapted implementation:

```ts
// src/shared/notchMarkdown.ts
// Ported from Cody notch-bubble.html (renderMarkdown/renderInline/escapeHtml), stripped of
// the code-language-label and green-span features. Renders a safe subset of markdown.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "<em>$1</em>")
    .replace(/(?<!\w)_([^_]+)_(?!\w)/g, "<em>$1</em>");
}

export function renderMarkdown(text: string): string {
  if (!text) return "";
  const lines = text.split("\n");
  let html = "";
  let inUl = false, inOl = false, inCode = false;
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceIndex = line.indexOf("```");
    if (fenceIndex !== -1) {
      const before = line.slice(0, fenceIndex);
      const after = line.slice(fenceIndex + 3);
      if (!inCode) {
        if (inUl) { html += "</ul>"; inUl = false; }
        if (inOl) { html += "</ol>"; inOl = false; }
        if (before.trim()) html += "<p>" + renderInline(before.trim()) + "</p>";
        inCode = true;
        codeLines = [];
        // ignore any language token after the fence
        if (after.trim()) { /* language label dropped */ }
      } else {
        if (before) codeLines.push(before);
        html += "<pre><code>" + escapeHtml(codeLines.join("\n")) + "</code></pre>";
        inCode = false;
        codeLines = [];
        if (after.trim()) lines.splice(i + 1, 0, after);
      }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }

    const trimmed = line.trim();
    if (!trimmed) {
      if (inUl) { html += "</ul>"; inUl = false; }
      if (inOl) { html += "</ol>"; inOl = false; }
      continue;
    }
    const ul = trimmed.match(/^[-*]\s+(.+)$/);
    if (ul) {
      if (inOl) { html += "</ol>"; inOl = false; }
      if (!inUl) { html += "<ul>"; inUl = true; }
      html += "<li>" + renderInline(ul[1]) + "</li>";
      continue;
    }
    const ol = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      if (inUl) { html += "</ul>"; inUl = false; }
      if (!inOl) { html += "<ol>"; inOl = true; }
      html += "<li>" + renderInline(ol[1]) + "</li>";
      continue;
    }
    if (inUl) { html += "</ul>"; inUl = false; }
    if (inOl) { html += "</ol>"; inOl = false; }

    const h3 = trimmed.match(/^###\s+(.+)$/); if (h3) { html += "<h3>" + renderInline(h3[1]) + "</h3>"; continue; }
    const h2 = trimmed.match(/^##\s+(.+)$/);  if (h2) { html += "<h2>" + renderInline(h2[1]) + "</h2>"; continue; }
    const h1 = trimmed.match(/^#\s+(.+)$/);   if (h1) { html += "<h1>" + renderInline(h1[1]) + "</h1>"; continue; }
    const bq = trimmed.match(/^>\s+(.+)$/);   if (bq) { html += "<blockquote>" + renderInline(bq[1]) + "</blockquote>"; continue; }

    html += "<p>" + renderInline(trimmed) + "</p>";
  }
  if (inCode) html += "<pre><code>" + escapeHtml(codeLines.join("\n")) + "</code></pre>";
  if (inUl) html += "</ul>";
  if (inOl) html += "</ol>";
  return html;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/usr/local/bin/node ./node_modules/vitest/vitest.mjs run tests/shared/notchMarkdown.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/notchMarkdown.ts tests/shared/notchMarkdown.test.ts
git commit -m "feat: safe markdown renderer for notch replies (ported from Cody, stripped)"
```

### Task 5: Notch HTML + CSS (morph shape)

**Files:**
- Rewrite: `src/renderer/notch/index.html`
- Rewrite: `src/renderer/notch/styles.css`

Reference the vendored `notch-bubble.html` CSS. Build the shape with: a header bar (drag handle + gear + collapse controls, hover-revealed), an inner content area (our turn UI), a settings sub-panel (opacity slider only), and right/bottom resize handles. DROP: font buttons, refresh, nav is REPLACED by our pagination, mode/language/capture markup.

- [ ] **Step 1: Rewrite `index.html`** — the shape structure (keep `#app` as the mount; ui.ts builds inner DOM, but the shape shell can live in HTML):

```html
<!-- src/renderer/notch/index.html -->
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Notch</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

(ui.ts builds the full `.notch-shape` structure so refs stay in one place — see Task 6.)

- [ ] **Step 2: Rewrite `styles.css`** — port the morph/pill/panel/hover-reveal/opacity CSS from `docs/superpowers/reference/cody/notch-bubble.html` (the `<style>` block, lines ~6-1238), keeping ONLY: `.notch-shape` (+ collapsed/expanded/floating/collapsing/dragging/resizing/hovering variants and transitions), `.notch-header`/`.notch-header-actions`/`.notch-header-btn`, `.notch-inner`, `.collapse-btn`, `.notch-resize-handle` (+ right/bottom), the opacity slider styles (`.notch-opacity-slider`), and the hover-reveal rules. Set the surface tint via `--notch-background-opacity` on a dark surface. Then add our content styles (status/turn/role/text/nav/typebox) adapted from the current styles.css. Keep `--notch-expanded-width` driving `.notch-shape.expanded` width and JS-set height.

Key invariants to preserve from Cody:
- `.notch-shape` collapsed = `width:300px; height:34px; border-radius:0 0 24px 24px;`
- expand transition: `width/height 0.5s cubic-bezier(0.34,1.56,0.64,1)`
- collapse: add `.collapsing` with `0.35s cubic-bezier(0.4,0,0.2,1)`
- `.notch-inner` fades in with `opacity` + `translateY` delay when `.expanded`
- controls `opacity:0` until `.notch-shape.hovering`/`.dragging`/`.resizing`
- `background-color: rgba(var(--notch-surface-rgb,0,0,0), var(--notch-background-opacity,1))`

- [ ] **Step 3: Manual check** — this task has no unit test (pure CSS/markup). Verified in Task 7's smoke.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/notch/index.html src/renderer/notch/styles.css
git commit -m "feat: notch morph-shape HTML/CSS (pill<->panel, hover-reveal, opacity) from Cody"
```

---

## Chunk 3: Notch renderer behavior wired to the turn pipeline

### Task 6: Rebuild `ui.ts` — shape DOM + turn render + pagination + opacity

**Files:**
- Rewrite: `src/renderer/notch/ui.ts`

Builds the full `.notch-shape` DOM once (header with gear+collapse, inner with content-area + settings sub-panel, resize handles), caches refs, and on render updates: status, current turn (role + `renderMarkdown(text)`), pagination counter/buttons, and the opacity slider value. Exposes the DOM refs the controller (main.ts) needs for the state machine + drag/resize.

Key requirements:
- `NotchState` gains `opacity: number`. `NotchActions` keeps `send/askNow/newSession/prev/next/openDashboard` and adds `setOpacity(v: number)` and `toggleCollapsed()`. **Pin this exact contract** (Task 6 and Task 7 must agree):

```ts
// src/renderer/notch/ui.ts — exported interfaces (locked contract)
import type { Turn } from "@shared/types";
export interface NotchState {
  turns: Turn[];
  index: number;
  statusLabel: string;
  opacity: number;       // 0.45..1, drives --notch-background-opacity
}
export interface NotchActions {
  send(text: string): Promise<boolean>; // clears input only on true (spec §7)
  askNow(): void;
  newSession(): void;                    // PRESERVE: end current session + clear (existing feature)
  prev(): void;
  next(): void;
  openDashboard(): void;
  setOpacity(v: number): void;           // persists + applies surface tint
  toggleCollapsed(): void;               // pill <-> panel (collapse button / pill click)
}
// buildNotch returns the DOM refs main.ts attaches drag/resize/morph listeners to:
export interface NotchRefs {
  shape: HTMLElement; header: HTMLElement; collapseBtn: HTMLElement; gearBtn: HTMLElement;
  newBtn: HTMLElement; resizeRight: HTMLElement; resizeBottom: HTMLElement; input: HTMLInputElement;
  opacitySlider: HTMLInputElement;
}
export function buildNotch(root: HTMLElement, actions: NotchActions): NotchRefs;
export function renderNotch(root: HTMLElement, state: NotchState, actions: NotchActions): void;
```

> **PRESERVE existing session-management features** (added after this plan was written): the notch must keep a **New** control (`actions.newSession()`) in the Cody chrome (e.g. a small header button), and `main.ts` must keep the `notch:continueSession` event listener + `continueSession(id)` logic that calls `startConverse(hooks, { continueSessionId: id })` and renders `converse.loadedTurns`. Do NOT drop these in the rebuild.

- The assistant/user turn text is rendered via `renderMarkdown` (import from `@shared/notchMarkdown`) into `.notch-content` (innerHTML), NOT textContent.
- The input + Send live in the footer of the inner panel; Enter submits (preserve Phase A behavior: clear only on success).
- Keep functions small; `buildNotch` builds the full `.notch-shape` structure once and returns `NotchRefs`.

Because this file coordinates DOM structure that main.ts drives, implement it together with Task 7 and typecheck/smoke as a pair. Full code is left to the implementer following the structure of the current `ui.ts` (build-once + render) plus the Cody shape; keep functions small.

- [ ] **Step 1** Implement `ui.ts` per above. Import `renderMarkdown` and `pageFor`.
- [ ] **Step 2** Typecheck: `npm run typecheck` — expect errors only from `main.ts` (rewritten next), or none if signatures align.
- [ ] **Step 3** Commit:

```bash
git add src/renderer/notch/ui.ts
git commit -m "feat: notch ui builds morph shape, renders markdown turns + pagination + opacity"
```

### Task 7: Rebuild `main.ts` — morph state machine + drag + resize + opacity + click-through

**Files:**
- Rewrite: `src/renderer/notch/main.ts`

Port the interaction logic from `docs/superpowers/reference/cody/notch-bubble.html`, stripped to what we need, wired to Phase A `startConverse`:

- **State machine** `collapsed|expanding|expanded|collapsing` (port `expand`/`collapse`/`transitionend`, notch-bubble.html:2492-2523). Header click or gear expands; collapse button collapses.
- **Drag** from header with 4px threshold + per-frame throttle + snap-back within `NOTCH.SNAP_PX` → pinned/floating (port :1690-1796). Uses `notch:move`, `notch:getPosition`, `notch:getNotchPosition`, `notch:setPinned`.
- **Resize** right/bottom handles with clamp + localStorage (port :1798-1882). Uses `notch:resize`. Import `NOTCH`/`clampSize` from `@shared/notchGeometry` (single source of truth, shared with the main controller).
- **Opacity** slider → `setOpacity` persists to localStorage, sets `--notch-background-opacity`.
- **Click-through**: on pointer enter/inside → `notch:setIgnoreMouse(false)`; on leave (not dragging/resizing) → `notch:setIgnoreMouse(true,{forward:true})` (port :2778-2811).
- **Turn wiring**: reuse Phase A controller logic (lazy `ensureConverse`, `pushTurn`, `send` returns success, `askNow`, `prev`/`next`, hotkey relay). **PRESERVE** `newSession()` and the `notch:continueSession` event → `continueSession(id)` (calls `startConverse(hooks,{continueSessionId:id})`, renders `converse.loadedTurns`) — both added after this plan and currently working.
- **End session**: no renderer involvement — main ends active sessions synchronously on quit (Task 3b). `converse.stop()` is no longer called from the renderer; it may be removed from the returned handle or left unused (note which).

- [ ] **Step 1** Implement `main.ts` per above.
- [ ] **Step 2** Typecheck + build: `npm run typecheck && npm run build` — expect PASS.
- [ ] **Step 3** Commit:

```bash
git add src/renderer/notch/main.ts src/renderer/notch/ui.ts
git commit -m "feat: notch morph/drag/resize/opacity/click-through wired to turn pipeline"
```

### Task 8: Full verification + manual smoke

- [ ] **Step 1** Full test suite: `npm test` — expect all green (Phase A 20 + notchGeometry 5 + notchMarkdown 5 = 30).
- [ ] **Step 2** Typecheck + build: `npm run typecheck && npm run build` — expect PASS.
- [ ] **Step 3** Manual smoke (`npm run dev`, Ollama + Handy running):
  1. App opens as a **pill** at top-center; the rest of the screen is click-through.
  2. Click the pill → **expands** to the panel with spring morph; inner content fades in.
  3. Type/dictate → Send → screenshot captured → Ollama reply renders as **markdown**; pagination counter advances; prev/next page through turns.
  4. **Drag** the header → window follows; drop near center → snaps back (pinned); drop far → stays (floating), corners fully rounded.
  5. **Resize** via right/bottom handles → clamps to 360–900 × 160–640; size persists across restart.
  6. Gear → settings sub-panel; **opacity** slider tints the surface 0.45–1.0; persists across restart.
  7. Collapse button → morphs back to the pill; click pill re-expands.
  8. Controls are hidden until you **hover** the shape.
  9. **Click-through:** with the pill collapsed, click a desktop icon / window directly below and around the pill — the click passes through (the notch does not eat it). Repeat right after hovering the pill then moving away fast (dead-zone check). Also confirm the **menu bar and tray icons** stay clickable with the notch at `screen-saver` level.
  10. Quit the app → the active DB session is ended (Dashboard shows it as `ended`).
- [ ] **Step 4** Commit any smoke fixes, then final review.

```bash
git add -A && git commit -m "chore: Phase B Cody-style notch complete"
```

---

## Done criteria (Phase B)

- Notch behaves like Cody: pill↔panel morph, drag+snap, edge resize, opacity tint, hover-reveal, click-through — all copied behaviors present.
- Turn Q&A + prev/next pagination work inside the panel; replies render as markdown.
- Size + opacity persist; sessions end on quit.
- `npm test` (29), `npm run typecheck`, `npm run build` all green.
