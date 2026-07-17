// src/main/windows/notchWindowController.ts
import { ipcMain, BrowserWindow, screen } from "electron";
import { IPC } from "@shared/ipcChannels";
import { NOTCH, notchBounds, clampSize } from "@shared/notchGeometry";

// Owns the notch window's live pinned state + geometry. The renderer drives drag/resize;
// main applies the moves/resizes and answers position queries.
export function registerNotchWindowControl(getNotch: () => BrowserWindow | null): void {
  let pinned = true;

  const notchOrigin = () => {
    const area = screen.getPrimaryDisplay().workArea;
    const b = notchBounds(area, NOTCH.DEFAULT_W);
    return { x: b.x, y: b.y };
  };

  // NOTE: the preload only exposes `invoke`, so EVERY channel the renderer calls must be
  // `ipcMain.handle` (invoke↔handle). Using `ipcMain.on` here would silently never fire and
  // leave the window permanently click-through / undraggable.
  ipcMain.handle(IPC.NOTCH_MOVE, (_e, x: number, y: number) => {
    const win = getNotch();
    if (win && !win.isDestroyed() && Number.isFinite(x) && Number.isFinite(y)) {
      win.setPosition(Math.round(x), Math.round(y));
    }
  });

  ipcMain.handle(IPC.NOTCH_RESIZE, (_e, width: number, height: number) => {
    const win = getNotch();
    if (!win || win.isDestroyed()) return;
    const size = clampSize({ width, height });
    const cur = win.getBounds();
    if (pinned) {
      const area = screen.getPrimaryDisplay().workArea;
      win.setBounds({ x: area.x + Math.round((area.width - size.width) / 2), y: area.y, width: size.width, height: size.height });
    } else {
      win.setBounds({ x: cur.x, y: cur.y, width: size.width, height: size.height });
    }
  });

  ipcMain.handle(IPC.NOTCH_GET_POSITION, () => {
    const win = getNotch();
    if (!win || win.isDestroyed()) return null;
    const [x, y] = win.getPosition();
    return { x, y };
  });

  ipcMain.handle(IPC.NOTCH_GET_NOTCH_POSITION, () => notchOrigin());

  ipcMain.handle(IPC.NOTCH_SET_PINNED, (_e, p: boolean) => { pinned = !!p; });

  ipcMain.handle(IPC.NOTCH_SET_IGNORE_MOUSE, (_e, ignore: boolean, options?: { forward?: boolean }) => {
    const win = getNotch();
    if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!!ignore, options || {});
  });
}
