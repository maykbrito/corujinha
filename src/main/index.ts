// src/main/index.ts
import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "path";
import { IPC } from "@shared/ipcChannels";
import { createNotchWindow } from "./windows/notchWindow";
import { createCaptureWorker } from "./windows/captureWorker";
import { openDashboardWindow } from "./windows/dashboardWindow";
import { openSettingsWindow, getSettingsWindow } from "./windows/settingsWindow";
import { openDatabase } from "./history/db";
import { HistoryStore } from "./history/historyStore";
import { ScreenCapturer } from "./screenCapturer";
import { registerIpc } from "./ipc";
import { registerNotchWindowControl } from "./windows/notchWindowController";
import { registerShortcuts, unregisterShortcuts, reloadShortcuts } from "./shortcuts";
import { makeElectronConfigStore } from "./config/configStore";

let notch: BrowserWindow | null = null;
let history: HistoryStore | null = null;
let quitting = false; // true only once a "real" window authorizes a quit (see before-quit)

// Use one stable app name for BOTH the dev build and the packaged .app, so they share a
// single userData folder (~/Library/Application Support/corujinha). Without this, the
// packaged app (productName "Corujinha") writes to a different folder than dev
// ("corujinha"), making the key + history look "lost" when switching builds.
// Must run before app is ready (getPath("userData") is derived from the name).
app.setName("corujinha");

app.whenReady().then(() => {
  const db = openDatabase(join(app.getPath("userData"), "corujinha.db"));
  history = new HistoryStore(db);
  const worker = createCaptureWorker();
  const capturer = new ScreenCapturer(worker);
  notch = createNotchWindow();
  // "Companion" window: never closes by accident. cmd+w on the notch is a no-op;
  // it only actually closes once a quit has been authorized from a real window (below).
  notch.on("close", (e) => { if (!quitting) e.preventDefault(); });
  registerIpc({ history, capturer, getNotch: () => notch });
  registerNotchWindowControl(() => notch);

  // The notch's header buttons open the dashboard / settings windows (no tray).
  ipcMain.handle("window:openDashboard", () => openDashboardWindow());
  ipcMain.handle("window:openSettings", () => openSettingsWindow());
  // Settings edits shortcut config, then asks main to re-register the global shortcuts.
  ipcMain.handle(IPC.SHORTCUTS_RELOAD, () => reloadShortcuts());

  const config = makeElectronConfigStore();
  registerShortcuts({
    getConfig: () => config.get(),
    sendToNotch: (channel, ...args) => notch?.webContents.send(channel, ...args),
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

// cmd+q only quits when the Settings window is focused — never from the notch,
// Dashboard, or when nothing is focused. Forces a deliberate "open Settings, then quit".
app.on("before-quit", (e) => {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && focused === getSettingsWindow()) { quitting = true; return; }
  e.preventDefault();
});


app.on("window-all-closed", () => {
  /* keep running on macOS; the notch is a companion window, not a normal app */
});
