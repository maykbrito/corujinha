// src/main/ipc.ts
import { ipcMain, BrowserWindow } from "electron";
import { IPC } from "@shared/ipcChannels";
import type { HistoryStore } from "./history/historyStore";
import type { ScreenCapturer } from "./screenCapturer";
import type { Turn, Capture } from "@shared/types";
import { makeElectronKeyStore } from "./keyStore";
import { mintEphemeralToken } from "./tokenMinter";
import { permissionStatus, requestMicrophone } from "./permissions";

export function registerIpc(deps: {
  history: HistoryStore;
  capturer: ScreenCapturer;
  getNotch: () => BrowserWindow | null;
}): void {
  const keys = makeElectronKeyStore();

  ipcMain.handle(IPC.KEY_GET_STATUS, () => keys.status());
  ipcMain.handle(IPC.KEY_SET, (_e, key: string) => {
    keys.set(key);
    return keys.status();
  });
  ipcMain.handle(IPC.TOKEN_MINT, async () => {
    const k = keys.get();
    if (!k) throw new Error("No API key set");
    return mintEphemeralToken(k);
  });

  ipcMain.handle(IPC.CAPTURE_SCREEN, () => deps.capturer.capture());
  // The capture worker reports each frame result back through this channel.
  ipcMain.handle("capture:result", (_e, id: string, r: { ok: boolean; dataUrl?: string; error?: string }) =>
    deps.capturer.resolve(id, r),
  );

  ipcMain.handle(IPC.HISTORY_START_SESSION, (_e, model: string) => deps.history.startSession(model));
  ipcMain.handle(IPC.HISTORY_END_SESSION, (_e, id: number) => deps.history.endSession(id));
  ipcMain.handle(IPC.HISTORY_ADD_TURN, (_e, t: Omit<Turn, "id" | "createdAt">) => deps.history.addTurn(t));
  ipcMain.handle(IPC.HISTORY_ADD_CAPTURE, (_e, c: Omit<Capture, "id" | "createdAt">) => deps.history.addCapture(c));
  ipcMain.handle(IPC.HISTORY_SET_CAPTURE_SUMMARY, (_e, id: number, summary: string) =>
    deps.history.setCaptureSummary(id, summary),
  );
  ipcMain.handle(IPC.HISTORY_LIST_SESSIONS, () => deps.history.listSessions());
  ipcMain.handle(IPC.HISTORY_LIST_TURNS, (_e, id: number) => deps.history.listTurns(id));
  ipcMain.handle(IPC.HISTORY_SEARCH, (_e, q: string) => deps.history.search(q));

  ipcMain.handle(IPC.NOTCH_SET_FOCUSABLE, (_e, on: boolean) => {
    const notch = deps.getNotch();
    if (!notch) return;
    notch.setFocusable(on);
    if (on) notch.focus();
  });

  ipcMain.handle(IPC.PERM_STATUS, () => permissionStatus());
  ipcMain.handle(IPC.PERM_REQUEST, () => requestMicrophone());
}
