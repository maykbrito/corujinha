// src/renderer/settings/main.ts
//
// Settings / onboarding. Configures the Ollama base URL + model (config:get / config:set)
// and shows screen-recording permission status with a deep-link to macOS settings.
import type { ConfigData, PermissionStatus } from "@shared/types";

const api = (window as any).api;
const urlInput = document.getElementById("ollama-url") as HTMLInputElement;
const modelInput = document.getElementById("ollama-model") as HTMLInputElement;
const saveBtn = document.getElementById("save-config") as HTMLButtonElement;
const cfgStatus = document.getElementById("config-status")!;
const screenStatusEl = document.getElementById("screen-status")!;
const openScreenBtn = document.getElementById("open-screen") as HTMLButtonElement;

async function loadConfig() {
  const c = (await api.invoke("config:get")) as ConfigData;
  urlInput.value = c.ollamaUrl;
  modelInput.value = c.model;
}
saveBtn.addEventListener("click", async () => {
  await api.invoke("config:set", { ollamaUrl: urlInput.value.trim(), model: modelInput.value.trim() });
  cfgStatus.textContent = "✓ Saved.";
  cfgStatus.className = "status ok";
});
async function refreshPermissions() {
  const p = (await api.invoke("perm:status")) as PermissionStatus;
  screenStatusEl.textContent = p.screen;
}
openScreenBtn.addEventListener("click", () => api.invoke("perm:openScreenSettings"));

loadConfig();
refreshPermissions();
