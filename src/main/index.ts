// src/main/index.ts
import { app, BrowserWindow } from "electron";
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
import { registerShortcuts, unregisterShortcuts } from "./shortcuts";

let notch: BrowserWindow | null = null;

app.whenReady().then(() => {
  const db = openDatabase(join(app.getPath("userData"), "see-and-talk.db"));
  const history = new HistoryStore(db);
  const worker = createCaptureWorker();
  const capturer = new ScreenCapturer(worker);
  notch = createNotchWindow();
  registerIpc({ history, capturer, getNotch: () => notch });

  createTray({
    openDashboard: () => openDashboardWindow(),
    openSettings: () => openSettingsWindow(),
  });

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
});

app.on("window-all-closed", () => {
  /* keep running in tray on macOS */
});
