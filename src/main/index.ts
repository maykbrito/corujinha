// src/main/index.ts
import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "path";
import { createNotchWindow } from "./windows/notchWindow";
import { createCaptureWorker } from "./windows/captureWorker";
import { openDashboardWindow } from "./windows/dashboardWindow";
import { openSettingsWindow } from "./windows/settingsWindow";
import { openDatabase } from "./history/db";
import { HistoryStore } from "./history/historyStore";
import { ScreenCapturer } from "./screenCapturer";
import { registerIpc } from "./ipc";
import { registerNotchWindowControl } from "./windows/notchWindowController";
import { registerShortcuts, unregisterShortcuts } from "./shortcuts";

let notch: BrowserWindow | null = null;
let history: HistoryStore | null = null;
let quitting = false; // true only once a "real" window authorizes a quit (see before-quit)

// Use one stable app name for BOTH the dev build and the packaged .app, so they share a
// single userData folder (~/Library/Application Support/see-and-talk). Without this, the
// packaged app (productName "See-and-Talk") writes to a different folder than dev
// ("see-and-talk"), making the key + history look "lost" when switching builds.
// Must run before app is ready (getPath("userData") is derived from the name).
app.setName("see-and-talk");

app.whenReady().then(() => {
  const db = openDatabase(join(app.getPath("userData"), "see-and-talk.db"));
  history = new HistoryStore(db);
  const worker = createCaptureWorker();
  const capturer = new ScreenCapturer(worker);
  notch = createNotchWindow();
  // Cody-style "companion" window: never closes by accident. cmd+w on the notch is a no-op;
  // it only actually closes once a quit has been authorized from a real window (below).
  notch.on("close", (e) => { if (!quitting) e.preventDefault(); });
  registerIpc({ history, capturer, getNotch: () => notch });
  registerNotchWindowControl(() => notch);

  // The notch's header buttons open the dashboard / settings windows (no tray).
  ipcMain.handle("window:openDashboard", () => openDashboardWindow());
  ipcMain.handle("window:openSettings", () => openSettingsWindow());

  registerShortcuts({
    sendToNotch: (channel) => notch?.webContents.send(channel),
    // Show/hide is a main-process job (re-showing a focusable:false panel).
    toggleNotch: () => {
      if (!notch) return;
      if (notch.isVisible()) notch.hide();
      else { notch.show(); notch.setIgnoreMouseEvents(true, { forward: true }); } // reset to click-through; hover re-enables
    },
  });
});

app.on("will-quit", () => {
  unregisterShortcuts();
  history?.endActiveSessions(); // close any active session synchronously before exit
});

// Cody model: cmd+q only quits when a real window (Settings/Dashboard) is focused — never
// from the notch or when nothing is focused. Forces a deliberate "open a window, then quit".
app.on("before-quit", (e) => {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && focused !== notch) { quitting = true; return; }
  e.preventDefault();
});


app.on("window-all-closed", () => {
  /* keep running in tray on macOS */
});
