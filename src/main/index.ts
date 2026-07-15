// src/main/index.ts
import { app, BrowserWindow } from "electron";
import { join } from "path";
import { createNotchWindow } from "./windows/notchWindow";
import { createCaptureWorker } from "./windows/captureWorker";
import { createTray } from "./tray";
import { openDatabase } from "./history/db";
import { HistoryStore } from "./history/historyStore";
import { ScreenCapturer } from "./screenCapturer";
import { registerIpc } from "./ipc";

let notch: BrowserWindow | null = null;

app.whenReady().then(() => {
  const db = openDatabase(join(app.getPath("userData"), "see-and-talk.db"));
  const history = new HistoryStore(db);
  const worker = createCaptureWorker();
  const capturer = new ScreenCapturer(worker);
  notch = createNotchWindow();
  registerIpc({ history, capturer, getNotch: () => notch });

  createTray({
    openDashboard: () => {}, // wired in Chunk 7
    openSettings: () => {}, // wired in Chunk 7
  });
});

app.on("window-all-closed", () => {
  /* keep running in tray on macOS */
});
