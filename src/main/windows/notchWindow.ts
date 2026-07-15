// src/main/windows/notchWindow.ts
import { BrowserWindow, screen } from "electron";
import { join } from "path";

export function createNotchWindow(): BrowserWindow {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: 420,
    height: 300,
    minWidth: 300,
    minHeight: 160,
    x: Math.round(width / 2 - 210),
    y: 0,
    frame: false,
    transparent: true,
    resizable: true, // native edge-resize; the panel no longer covers edges with a drag region
    hasShadow: false,
    // Focusable so the type box can receive keyboard input. It only activates the app when
    // you click it (to type) — voice-only use never clicks it, so it doesn't steal focus.
    focusable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
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
