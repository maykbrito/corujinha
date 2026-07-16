// src/main/shortcuts.ts
import { globalShortcut } from "electron";
import { IPC_EVENT } from "@shared/ipcChannels";

// Ask now is renderer-targeted (the notch owns the turn pipeline). Show/hide is
// main-targeted, because re-showing a focusable OS window is a main-process job.
export function registerShortcuts(deps: {
  sendToNotch: (channel: string) => void;
  toggleNotch: () => void;
}): void {
  globalShortcut.register("CommandOrControl+Shift+A", () => deps.sendToNotch(IPC_EVENT.HOTKEY_ASK_NOW));
  globalShortcut.register("CommandOrControl+Shift+H", () => deps.toggleNotch());
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}
