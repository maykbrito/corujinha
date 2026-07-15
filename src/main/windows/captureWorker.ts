// src/main/windows/captureWorker.ts
import { BrowserWindow, session, desktopCapturer } from "electron";
import { join } from "path";

export function createCaptureWorker(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1, height: 1, show: false,
    webPreferences: { preload: join(__dirname, "../preload/index.js"), offscreen: false },
  });
  // Authorize getDisplayMedia to the primary screen with no picker.
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ["screen"] })
      .then((sources) => {
        // Empty on missing Screen Recording permission — deny so getDisplayMedia rejects
        // promptly instead of hanging until the capturer's 5s timeout.
        if (!sources.length) return cb({});
        cb({ video: sources[0] });
      })
      .catch(() => cb({}));
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/captureWorker/index.html`);
  } else {
    win.loadFile(join(__dirname, "../renderer/captureWorker/index.html"));
  }
  return win;
}
