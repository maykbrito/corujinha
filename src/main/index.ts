// src/main/index.ts
import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "path";
import { createNotchWindow } from "./windows/notchWindow";
import { createCaptureWorker } from "./windows/captureWorker";
import { openDashboardWindow } from "./windows/dashboardWindow";
import { openSettingsWindow } from "./windows/settingsWindow";
import { createTray } from "./tray";
import { openDatabase } from "./history/db";
import { HistoryStore } from "./history/historyStore";
import { ScreenCapturer } from "./screenCapturer";
import { registerIpc } from "./ipc";
import { registerNotchWindowControl } from "./windows/notchWindowController";
import { registerShortcuts, unregisterShortcuts } from "./shortcuts";

let notch: BrowserWindow | null = null;
let history: HistoryStore | null = null;

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
  registerIpc({ history, capturer, getNotch: () => notch });
  registerNotchWindowControl(() => notch);

  createTray({
    openDashboard: () => openDashboardWindow(),
    openSettings: () => openSettingsWindow(),
  });

  // The notch's "dashboard" link opens the dashboard window.
  ipcMain.handle("window:openDashboard", () => openDashboardWindow());

  registerShortcuts({
    sendToNotch: (channel) => notch?.webContents.send(channel),
    // Show/hide is a main-process job (re-showing a focusable:false panel).
    toggleNotch: () => {
      if (!notch) return;
      if (notch.isVisible()) notch.hide();
      else notch.show();
    },
  });
});

app.on("will-quit", () => {
  unregisterShortcuts();
  history?.endActiveSessions(); // close any active session synchronously before exit
});


app.on("window-all-closed", () => {
  /* keep running in tray on macOS */
});
