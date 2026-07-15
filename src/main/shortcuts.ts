// src/main/shortcuts.ts
import { globalShortcut } from "electron";
import { IPC_EVENT } from "@shared/ipcChannels";

// Ask now / toggle mute are renderer-targeted (the session lives in the notch). Show/hide
// is main-targeted, because re-showing a focusable:false OS window is a main-process job.
export function registerShortcuts(deps: {
  sendToNotch: (channel: string) => void;
  toggleNotch: () => void;
}): void {
  globalShortcut.register("CommandOrControl+Shift+A", () => deps.sendToNotch(IPC_EVENT.HOTKEY_ASK_NOW));
  globalShortcut.register("CommandOrControl+Shift+M", () => deps.sendToNotch(IPC_EVENT.HOTKEY_TOGGLE_MUTE));
  globalShortcut.register("CommandOrControl+Shift+H", () => deps.toggleNotch());
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}
