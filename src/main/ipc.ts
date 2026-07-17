// src/main/ipc.ts
import { ipcMain, BrowserWindow, app, shell } from "electron";
import { join, resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { IPC, IPC_EVENT } from "@shared/ipcChannels";
import type { HistoryStore } from "./history/historyStore";
import type { ScreenCapturer } from "./screenCapturer";
import type { Turn, Capture } from "@shared/types";
import { makeElectronConfigStore } from "./config/configStore";
import { ollamaChat, type ChatMessage } from "./ollama/ollamaClient";
import { permissionStatus, openScreenRecordingSettings } from "./permissions";

export function registerIpc(deps: {
  history: HistoryStore;
  capturer: ScreenCapturer;
  getNotch: () => BrowserWindow | null;
}): void {
  const config = makeElectronConfigStore();

  // Hide the notch from screen capture/recording (content protection) per config.
  const applyContentProtection = () => {
    const notch = deps.getNotch();
    if (notch && !notch.isDestroyed()) notch.setContentProtection(config.get().hideFromCapture);
  };
  applyContentProtection(); // startup: honor the persisted setting

  ipcMain.handle(IPC.CONFIG_GET, () => config.get());
  ipcMain.handle(IPC.CONFIG_SET, (_e, partial) => {
    const next = config.set(partial);
    applyContentProtection();
    if (partial && "opacity" in partial) {
      const notch = deps.getNotch();
      if (notch && !notch.isDestroyed()) notch.webContents.send(IPC_EVENT.NOTCH_SET_OPACITY, next.opacity);
    }
    return next;
  });
  ipcMain.handle(IPC.OLLAMA_CHAT, (_e, messages: ChatMessage[]) => ollamaChat(fetch, config.get(), messages));

  ipcMain.handle(IPC.CAPTURE_SCREEN, () => deps.capturer.capture());
  // The capture worker reports each frame result back through this channel.
  ipcMain.handle("capture:result", (_e, id: string, r: { ok: boolean; dataUrl?: string; error?: string }) =>
    deps.capturer.resolve(id, r),
  );

  ipcMain.handle(IPC.HISTORY_START_SESSION, (_e, model: string) => deps.history.startSession(model));
  ipcMain.handle(IPC.HISTORY_END_SESSION, (_e, id: number) => deps.history.endSession(id));
  ipcMain.handle(IPC.HISTORY_ADD_TURN, (_e, t: Omit<Turn, "id" | "createdAt">) => deps.history.addTurn(t));
  ipcMain.handle(IPC.HISTORY_ADD_CAPTURE, (_e, c: Omit<Capture, "id" | "createdAt">) => deps.history.addCapture(c));
  ipcMain.handle(IPC.HISTORY_LIST_SESSIONS, () => deps.history.listSessions());
  ipcMain.handle(IPC.HISTORY_LIST_TURNS, (_e, id: number) => deps.history.listTurns(id));
  ipcMain.handle(IPC.HISTORY_LIST_CAPTURES, (_e, id: number) => deps.history.listCaptures(id));
  ipcMain.handle(IPC.HISTORY_SEARCH, (_e, q: string) => deps.history.search(q));
  ipcMain.handle(IPC.HISTORY_REOPEN_SESSION, (_e, id: number) => deps.history.reopenSession(id));

  // Continue a session from the Dashboard: reveal the notch and tell it to load + resume `id`.
  ipcMain.handle(IPC.SESSION_CONTINUE, (_e, id: number) => {
    const notch = deps.getNotch();
    if (!notch) return;
    notch.show();
    notch.setIgnoreMouseEvents(true, { forward: true }); // reset to click-through; hover re-enables
    notch.webContents.send(IPC_EVENT.NOTCH_CONTINUE_SESSION, id);
  });

  // Read a stored capture thumbnail into a data URL for the dashboard. Restricted to the
  // app's captures directory so a renderer can't read arbitrary files.
  ipcMain.handle(IPC.CAPTURE_THUMB, (_e, thumbPath: string): string | null => {
    const resolved = safeCapturePath(thumbPath);
    if (!resolved) return null;
    try {
      // Derive the mime from the extension so both new .jpg and any legacy .webp render.
      const mime = resolved.endsWith(".webp") ? "image/webp" : "image/jpeg";
      return `data:${mime};base64,` + readFileSync(resolved).toString("base64");
    } catch {
      return null;
    }
  });

  // Open a stored screenshot in the default image viewer (Preview) — restricted to captures dir.
  ipcMain.handle(IPC.CAPTURE_OPEN, (_e, thumbPath: string) => {
    const resolved = safeCapturePath(thumbPath);
    if (resolved) shell.openPath(resolved);
  });

  // Reveal a stored screenshot in Finder — restricted to captures dir.
  ipcMain.handle(IPC.CAPTURE_REVEAL, (_e, thumbPath: string) => {
    const resolved = safeCapturePath(thumbPath);
    if (resolved) shell.showItemInFolder(resolved);
  });

  ipcMain.handle(IPC.NOTCH_SET_FOCUSABLE, (_e, on: boolean) => {
    const notch = deps.getNotch();
    if (!notch) return;
    notch.setFocusable(on);
    if (on) notch.focus();
  });

  ipcMain.handle(IPC.PERM_STATUS, () => permissionStatus());
  ipcMain.handle(IPC.PERM_OPEN_SCREEN_SETTINGS, () => openScreenRecordingSettings());
}

// Resolve a path only if it lives inside the app's captures directory and exists.
// Guards the file-read/open/reveal handlers against arbitrary-path access from a renderer.
function safeCapturePath(thumbPath: string): string | null {
  try {
    const dir = join(app.getPath("userData"), "captures");
    const resolved = resolve(thumbPath);
    return resolved.startsWith(dir) && existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
}
