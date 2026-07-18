// src/main/windows/notchWindow.ts
import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { NOTCH, notchBounds } from "@shared/notchGeometry";

// The OS window is sized to the expanded panel and stays put; the renderer
// morphs the visible .notch-shape (pill <-> panel) with CSS inside it. The window is
// click-through by default so the transparent area around the pill/panel forwards clicks;
// the renderer disables click-through only while the pointer is inside the shape.
export function createNotchWindow(): BrowserWindow {
  const area = screen.getPrimaryDisplay().workArea;
  const b = notchBounds(area, NOTCH.DEFAULT_W); // window is DEFAULT_W wide; pill is centered via CSS
  const win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: NOTCH.DEFAULT_W,
    height: NOTCH.DEFAULT_H, // window == expanded-panel size; the pill is CSS-morphed inside it
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false, // custom edge-resize in the renderer
    movable: false,   // moved via IPC during drag
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
