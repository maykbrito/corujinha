// src/main/windows/dashboardWindow.ts
import { BrowserWindow } from "electron";
import { join } from "path";

// Lazily-created normal window; if already open, focus it instead of spawning a second.
let win: BrowserWindow | null = null;

export function openDashboardWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) {
    win.focus();
    return win;
  }
  win = new BrowserWindow({
    width: 760,
    height: 560,
    title: "See-and-Talk — Dashboard",
    webPreferences: { preload: join(__dirname, "../preload/index.js") },
  });
  win.on("closed", () => {
    win = null;
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/dashboard/index.html`);
  } else {
    win.loadFile(join(__dirname, "../renderer/dashboard/index.html"));
  }
  return win;
}
