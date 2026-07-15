// src/renderer/settings/main.ts
//
// Settings / onboarding. Sets the API key (key:set), shows a "key is set" indicator
// (key:status), reports mic/screen permission status (perm:status), and offers a mic
// request + a deep-link to macOS Screen Recording settings. Shortcut editing is deferred
// in v1 — the HTML just displays the defaults.
import type { KeyStatus, PermissionStatus } from "@shared/types";

const api = (window as any).api;

const keyInput = document.getElementById("key") as HTMLInputElement;
const saveKeyBtn = document.getElementById("save-key") as HTMLButtonElement;
const keyStatusEl = document.getElementById("key-status")!;
const micStatusEl = document.getElementById("mic-status")!;
const screenStatusEl = document.getElementById("screen-status")!;
const reqMicBtn = document.getElementById("req-mic") as HTMLButtonElement;
const openScreenBtn = document.getElementById("open-screen") as HTMLButtonElement;

async function refreshKeyStatus() {
  const s = (await api.invoke("key:status")) as KeyStatus;
  keyStatusEl.textContent = s.hasKey ? "✓ A key is set." : "No key set yet.";
  keyStatusEl.className = "status " + (s.hasKey ? "ok" : "warn");
}

saveKeyBtn.addEventListener("click", async () => {
  const key = keyInput.value.trim();
  if (!key) return;
  try {
    await api.invoke("key:set", key);
    keyInput.value = "";
    keyStatusEl.textContent = "Saving…";
    await refreshKeyStatus();
  } catch (e) {
    keyStatusEl.textContent = "Could not save key: " + String(e);
    keyStatusEl.className = "status warn";
  }
});

async function refreshPermissions() {
  const p = (await api.invoke("perm:status")) as PermissionStatus;
  micStatusEl.textContent = p.microphone;
  screenStatusEl.textContent = p.screen;
}

reqMicBtn.addEventListener("click", async () => {
  await api.invoke("perm:request");
  await refreshPermissions();
});

openScreenBtn.addEventListener("click", () => api.invoke("perm:openScreenSettings"));

refreshKeyStatus();
refreshPermissions();
