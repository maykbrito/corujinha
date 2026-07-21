// src/renderer/selection/main.ts
// Full-screen drag-select overlay. Reports the selection rect (CSS points, relative to the
// overlay = the display's work area) to main via `selection:done`, or `selection:cancel`
// on ESC / an empty selection. The window is closed by main after either.
import type { Rect } from "@shared/cropRect";
const api = (window as any).api;

const box = document.getElementById("sel")!;
const dims = document.getElementById("dims")!;
let start: { x: number; y: number } | null = null;

function norm(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function draw(r: Rect) {
  box.hidden = false;
  (box as HTMLElement).style.left = `${r.x}px`;
  (box as HTMLElement).style.top = `${r.y}px`;
  (box as HTMLElement).style.width = `${r.w}px`;
  (box as HTMLElement).style.height = `${r.h}px`;
  dims.textContent = `${Math.round(r.w)} × ${Math.round(r.h)}`;
}

addEventListener("mousedown", (e) => { start = { x: e.clientX, y: e.clientY }; });
addEventListener("mousemove", (e) => { if (start) draw(norm(start, { x: e.clientX, y: e.clientY })); });
addEventListener("mouseup", (e) => {
  if (!start) return;
  const r = norm(start, { x: e.clientX, y: e.clientY });
  start = null;
  if (r.w < 4 || r.h < 4) return void api.invoke("selection:cancel");
  api.invoke("selection:done", r);
});
addEventListener("keydown", (e) => { if (e.key === "Escape") api.invoke("selection:cancel"); });
