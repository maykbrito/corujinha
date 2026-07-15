// src/main/index.ts
import { app, BrowserWindow } from "electron";
import { createNotchWindow } from "./windows/notchWindow";
import { createTray } from "./tray";

let notch: BrowserWindow | null = null;

app.whenReady().then(() => {
  notch = createNotchWindow();
  createTray({
    openDashboard: () => { /* wired in Chunk 7 */ },
    openSettings: () => { /* wired in Chunk 7 */ },
  });
});

app.on("window-all-closed", () => { /* keep running in tray on macOS */ });
