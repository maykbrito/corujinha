// src/main/windows/selectionOverlay.ts
import { BrowserWindow, screen, ipcMain } from "electron";
import { join } from "path";
import type { Rect } from "@shared/cropRect";

export interface RegionSelection {
  rect: Rect;
  disp: { pointW: number; pointH: number };
}

// Open a full-screen, transparent, click-capturing overlay for a one-shot region select.
// Resolves with the selection (CSS points + display info) or null if canceled/closed.
// ponytail: primary display only; multi-monitor (display under cursor + offset) is a follow-up.
export function captureRegionRect(): Promise<RegionSelection | null> {
  const d = screen.getPrimaryDisplay();
  const { x, y, width, height } = d.bounds;
  const win = new BrowserWindow({
    x, y, width, height,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    enableLargerThanScreen: true,
    webPreferences: { preload: join(__dirname, "../preload/index.js") },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/selection/index.html`);
  } else {
    win.loadFile(join(__dirname, "../renderer/selection/index.html"));
  }
  win.focus();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: RegionSelection | null) => {
      if (settled) return;
      settled = true;
      ipcMain.removeHandler("selection:done");
      ipcMain.removeHandler("selection:cancel");
      if (!win.isDestroyed()) win.close();
      resolve(value);
    };
    ipcMain.handle("selection:done", (_e, rect: Rect) =>
      finish({ rect, disp: { pointW: width, pointH: height } }),
    );
    ipcMain.handle("selection:cancel", () => finish(null));
    win.on("closed", () => finish(null)); // closed without a choice → cancel
  });
}
