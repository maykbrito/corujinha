// src/main/permissions.ts
import { systemPreferences, shell } from "electron";
import type { PermissionStatus } from "@shared/types";

// getMediaAccessStatus can return granted|denied|restricted|not-determined|unknown.
// Collapse restricted/unknown -> denied for our tri-state.
function norm(s: string): PermissionStatus["screen"] {
  if (s === "granted" || s === "denied" || s === "not-determined") return s;
  return "denied";
}

export function permissionStatus(): PermissionStatus {
  return { screen: norm(systemPreferences.getMediaAccessStatus("screen")) };
}

// Screen recording cannot be requested programmatically; deep-link to System Settings.
export function openScreenRecordingSettings(): void {
  shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
}
