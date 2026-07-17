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
const hideFromCapture = document.getElementById("hide-from-capture") as HTMLInputElement;
const opacity = document.getElementById("opacity") as HTMLInputElement;
const opacityVal = document.getElementById("opacity-val")!;
const screenStatusEl = document.getElementById("screen-status")!;
const openScreenBtn = document.getElementById("open-screen") as HTMLButtonElement;

async function loadConfig() {
  const c = (await api.invoke("config:get")) as ConfigData;
  urlInput.value = c.ollamaUrl;
  modelInput.value = c.model;
  hideFromCapture.checked = c.hideFromCapture;
  opacity.value = String(c.opacity);
  opacityVal.textContent = `${Math.round(c.opacity * 100)}%`;
}
saveBtn.addEventListener("click", async () => {
  await api.invoke("config:set", {
    ollamaUrl: urlInput.value.trim(),
    model: modelInput.value.trim(),
    hideFromCapture: hideFromCapture.checked,
  });
  cfgStatus.textContent = "✓ Saved.";
  cfgStatus.className = "status ok";
});
// Apply capture visibility immediately on toggle (no need to hit Save).
hideFromCapture.addEventListener("change", () =>
  api.invoke("config:set", { hideFromCapture: hideFromCapture.checked }),
);
// Opacity is applied live to the notch (main pushes the change) as you drag.
opacity.addEventListener("input", () => {
  const v = parseFloat(opacity.value);
  opacityVal.textContent = `${Math.round(v * 100)}%`;
  api.invoke("config:set", { opacity: v });
});
async function refreshPermissions() {
  const p = (await api.invoke("perm:status")) as PermissionStatus;
  screenStatusEl.textContent = p.screen;
}
openScreenBtn.addEventListener("click", () => api.invoke("perm:openScreenSettings"));

loadConfig();
refreshPermissions();
