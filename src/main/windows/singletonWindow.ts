// src/main/windows/singletonWindow.ts
import { BrowserWindow } from "electron";
import { join } from "path";

// A lazily-created normal window: focus if already open, recreate after close.
// Shared by the Dashboard and Settings windows (they differ only in size/title/route).
export function makeSingletonWindow(opts: { width: number; height: number; title: string; route: string }) {
  let win: BrowserWindow | null = null;
  const get = (): BrowserWindow | null => (win && !win.isDestroyed() ? win : null);
  const open = (): BrowserWindow => {
    const existing = get();
    if (existing) {
      existing.focus();
      return existing;
    }
    win = new BrowserWindow({
      width: opts.width,
      height: opts.height,
      title: opts.title,
      webPreferences: { preload: join(__dirname, "../preload/index.js") },
    });
    win.on("closed", () => { win = null; });
    if (process.env["ELECTRON_RENDERER_URL"]) {
      win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/${opts.route}/index.html`);
    } else {
      win.loadFile(join(__dirname, `../renderer/${opts.route}/index.html`));
    }
    return win;
  };
  return { open, get };
}
