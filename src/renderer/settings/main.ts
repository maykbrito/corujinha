// src/renderer/settings/main.ts
//
// Settings / onboarding. Configures the Ollama base URL + model (config:get / config:set)
// and shows screen-recording permission status with a deep-link to macOS settings.
import type { ConfigData, PermissionStatus, ShortcutMap } from "@shared/types";

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
  shortcuts = c.shortcuts;
  renderShortcuts();
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

// ---- tabs ----
const tabs = Array.from(document.querySelectorAll<HTMLElement>(".tab"));
const panels = Array.from(document.querySelectorAll<HTMLElement>(".tab-panel"));
for (const tab of tabs) {
  tab.addEventListener("click", () => {
    const name = tab.dataset.tab;
    for (const t of tabs) t.classList.toggle("active", t === tab);
    for (const p of panels) p.classList.toggle("active", p.id === `tab-${name}`);
  });
}

// ---- shortcuts ----
const shortcutInputs = Array.from(document.querySelectorAll<HTMLInputElement>(".shortcut-input"));
const shortcutStatus = document.getElementById("shortcut-status")!;
let shortcuts: ShortcutMap;

// Turn a KeyboardEvent into an Electron accelerator, or null if it's only modifiers / has none.
function toAccelerator(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.metaKey || e.ctrlKey) mods.push("CommandOrControl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  const named: Record<string, string> = {
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    " ": "Space", Escape: "Escape", Enter: "Enter", Tab: "Tab", Backspace: "Backspace",
    PageUp: "PageUp", PageDown: "PageDown", Home: "Home", End: "End",
  };
  const k = e.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(k)) return null; // modifier only
  const key = named[k] ?? (k.length === 1 ? k.toUpperCase() : k);
  if (mods.length === 0) return null; // global shortcuts need a modifier
  return [...mods, key].join("+");
}

// Compact display: CommandOrControl+Shift+Up -> ⌘⇧↑
function pretty(accel: string): string {
  return accel
    .replace("CommandOrControl", "⌘")
    .replace("Command", "⌘").replace("Control", "⌃")
    .replace("Alt", "⌥").replace("Shift", "⇧")
    .replace("Up", "↑").replace("Down", "↓").replace("Left", "←").replace("Right", "→")
    .replace(/\+/g, "");
}

function renderShortcuts() {
  for (const input of shortcutInputs) {
    const key = input.dataset.shortcut as keyof ShortcutMap;
    input.value = shortcuts[key] ? pretty(shortcuts[key]) : "";
  }
}

for (const input of shortcutInputs) {
  input.addEventListener("keydown", async (e) => {
    e.preventDefault();
    const accel = toAccelerator(e);
    if (!accel) return;
    const key = input.dataset.shortcut as keyof ShortcutMap;
    shortcuts = { ...shortcuts, [key]: accel };
    await api.invoke("config:set", { shortcuts });
    await api.invoke("shortcuts:reload");
    renderShortcuts();
    shortcutStatus.textContent = "✓ Saved.";
    shortcutStatus.className = "status ok";
  });
}

loadConfig();
refreshPermissions();
