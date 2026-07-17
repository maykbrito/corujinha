// src/main/shortcuts.ts
import { globalShortcut } from "electron";
import { IPC_EVENT } from "@shared/ipcChannels";
import type { ConfigData } from "./config/configStore";

// Ask now / show-hide are fixed; the four navigation shortcuts (scroll + page) are
// user-configurable and read from config, so they can be re-registered after an edit.
interface ShortcutDeps {
  getConfig: () => ConfigData;
  sendToNotch: (channel: string, ...args: unknown[]) => void;
  toggleNotch: () => void;
}

let deps: ShortcutDeps | null = null;

export function registerShortcuts(d: ShortcutDeps): void {
  deps = d;
  applyShortcuts();
}

// Called after Settings edits the shortcut config.
export function reloadShortcuts(): void {
  if (deps) applyShortcuts();
}

function applyShortcuts(): void {
  const d = deps!;
  globalShortcut.unregisterAll();
  const s = d.getConfig().shortcuts;
  reg("CommandOrControl+Shift+A", () => d.sendToNotch(IPC_EVENT.HOTKEY_ASK_NOW));
  reg("CommandOrControl+Shift+H", () => d.toggleNotch());
  reg(s.prevPage, () => d.sendToNotch(IPC_EVENT.NOTCH_PAGE, "prev"));
  reg(s.nextPage, () => d.sendToNotch(IPC_EVENT.NOTCH_PAGE, "next"));
  reg(s.scrollUp, () => d.sendToNotch(IPC_EVENT.NOTCH_SCROLL, "up"));
  reg(s.scrollDown, () => d.sendToNotch(IPC_EVENT.NOTCH_SCROLL, "down"));
}

// Register one accelerator, ignoring blanks and invalid/duplicate combos so a bad entry
// can't crash startup or the reload.
function reg(accel: string, fn: () => void): void {
  if (!accel) return;
  try { globalShortcut.register(accel, fn); } catch { /* invalid accelerator — skip */ }
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}
