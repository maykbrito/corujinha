// src/main/windows/settingsWindow.ts
import { BrowserWindow } from "electron";
import { join } from "path";

// Lazily-created normal window; focus if already open.
let win: BrowserWindow | null = null;

export function openSettingsWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) {
    win.focus();
    return win;
  }
  win = new BrowserWindow({
    width: 520,
    height: 560,
    title: "See-and-Talk — Settings",
    webPreferences: { preload: join(__dirname, "../preload/index.js") },
  });
  win.on("closed", () => {
    win = null;
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/settings/index.html`);
  } else {
    win.loadFile(join(__dirname, "../renderer/settings/index.html"));
  }
  return win;
}
