// src/main/permissions.ts
import { systemPreferences, shell } from "electron";
import type { PermissionStatus } from "@shared/types";

// getMediaAccessStatus can return granted|denied|restricted|not-determined|unknown.
// Collapse restricted/unknown -> denied for our tri-state.
function norm(s: string): PermissionStatus["microphone"] {
  if (s === "granted" || s === "denied" || s === "not-determined") return s;
  return "denied";
}

export function permissionStatus(): PermissionStatus {
  return {
    microphone: norm(systemPreferences.getMediaAccessStatus("microphone")),
    screen: norm(systemPreferences.getMediaAccessStatus("screen")),
  };
}

export async function requestMicrophone(): Promise<boolean> {
  return systemPreferences.askForMediaAccess("microphone");
}
// Screen recording cannot be requested programmatically; deep-link to System Settings.
export function openScreenRecordingSettings(): void {
  shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
}
