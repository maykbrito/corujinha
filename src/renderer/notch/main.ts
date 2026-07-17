// src/renderer/notch/main.ts
//
// Notch controller. Owns:
//  - the turn pipeline (Phase A) + session management (New / Continue),
//  - the Cody-style morph state machine (pill <-> panel),
//  - drag-with-snap, edge resize, opacity tint, and click-through toggling.
import { buildNotch, renderNotch, setCollapseIcon, type NotchState, type NotchActions, type NotchRefs } from "./ui";
import { startConverse, type Converse, type ConverseHooks } from "./realtime";
import { NOTCH, clampSize, clampOpacity, snapDistance } from "@shared/notchGeometry";
import type { Turn } from "@shared/types";

const api = (window as any).api;
const root = document.getElementById("app")!;

// ---- turn state (Phase A + session management) ----
let turns: Turn[] = [];
let index = 0;
let statusLabel = "";
let converse: Converse | null = null;
let turnSeq = 0; // monotonic local id for rendered turns (not the DB rowid)

// ---- notch chrome state ----
type Morph = "collapsed" | "expanding" | "expanded" | "collapsing";
let morph: Morph = "collapsed";
let pinned = true;
let opacity = 1; // 0.45..1; sourced from config, live-synced from Settings
let size = loadSize();

function loadSize() {
  try {
    const s = JSON.parse(localStorage.getItem("notchSize") || "null");
    if (s && Number.isFinite(s.width) && Number.isFinite(s.height)) return clampSize(s);
  } catch { /* ignore */ }
  return { width: NOTCH.DEFAULT_W, height: NOTCH.DEFAULT_H };
}

function render() {
  const state: NotchState = { turns, index, statusLabel };
  renderNotch(root, state, actions);
}
function pushTurn(role: Turn["role"], text: string) {
  turns = [...turns, { id: ++turnSeq, sessionId: converse?.getSessionId() ?? 0, role, source: "typed", text, createdAt: Date.now() }];
  index = turns.length - 1;
  render();
}

const hooks: ConverseHooks = {
  onUserText: (t) => pushTurn("user", t),
  onAssistantText: (t) => pushTurn("assistant", t),
  onStatus: (s) => { statusLabel = s === "capture-failed" ? "screen capture failed — text only" : s; render(); },
};

async function ensureConverse(): Promise<Converse> {
  if (converse) return converse;
  converse = await startConverse(hooks);
  return converse;
}

async function continueSession(id: number) {
  await converse?.stop().catch(() => {});
  statusLabel = "";
  converse = await startConverse(hooks, { continueSessionId: id });
  turns = converse.loadedTurns;
  index = Math.max(0, turns.length - 1);
  if (morph === "collapsed") expand(); // reveal the loaded conversation
  render();
}

const actions: NotchActions = {
  async send(text) {
    try { return await (await ensureConverse()).ask(text); }
    catch { return false; }
  },
  async askNow() { (await ensureConverse()).askNow().catch(() => {}); },
  async newSession() {
    await converse?.stop().catch(() => {});
    converse = null; turns = []; index = 0; statusLabel = "";
    render();
  },
  prev() { index = Math.max(0, index - 1); render(); },
  next() { index = Math.min(turns.length - 1, index + 1); render(); },
  openDashboard() { api.invoke("window:openDashboard"); },
  openSettings() { api.invoke("window:openSettings"); },
  regenerate() { converse?.regenerate().catch(() => {}); },
  suggestFollowUps() { return converse?.suggestFollowUps().catch(() => []) ?? Promise.resolve([]); },
};

// ---- build + wire chrome ----
const refs = buildNotch(root, actions);

function applyOpacity() { refs.shape.style.setProperty("--notch-bg-opacity", String(opacity)); }

// ---- morph ----
function expand() {
  if (morph === "expanded" || morph === "expanding") return;
  refs.shape.classList.remove("collapsing");
  morph = "expanding";
  refs.shape.classList.add("expanded");
  morph = "expanded";
  setCollapseIcon(refs, true);
}
function collapse() {
  if (morph === "collapsed" || morph === "collapsing") return;
  morph = "collapsing";
  refs.shape.classList.add("collapsing");
  refs.shape.classList.remove("expanded");
  setCollapseIcon(refs, false);
}
refs.shape.addEventListener("transitionend", (e) => {
  if (e.propertyName === "height" && morph === "collapsing") {
    morph = "collapsed";
    refs.shape.classList.remove("collapsing");
  }
});
// The collapse button toggles: minimize when expanded, expand when collapsed.
refs.collapseBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (morph === "expanded") collapse();
  else if (morph === "collapsed") expand();
});

// ---- click-through ----
function isInsideShape(e: MouseEvent) {
  const r = refs.shape.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}
function restoreClickThroughIfOutside(e: MouseEvent) {
  if (!isInsideShape(e)) {
    refs.shape.classList.remove("hovering");
    api.invoke("notch:setIgnoreMouse", true, { forward: true });
  }
}
refs.shape.addEventListener("mouseenter", () => {
  refs.shape.classList.add("hovering");
  api.invoke("notch:setIgnoreMouse", false);
});
refs.shape.addEventListener("mouseleave", () => {
  refs.shape.classList.remove("hovering");
  if (isDragging || dragPending || resizing) return; // keep capturing during a gesture
  api.invoke("notch:setIgnoreMouse", true, { forward: true });
});

// ---- drag (header handle) with snap-back ----
let dragPending = false, isDragging = false, dragReady = false;
let startSX = 0, startSY = 0, startWX = 0, startWY = 0, originX = 0, originY = 0;
let dragRAF: number | null = null;

refs.header.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest(".notch-hbtn")) return; // header buttons aren't drag
  dragPending = true; dragReady = false;
  startSX = e.screenX; startSY = e.screenY;
  api.invoke("notch:getNotchPosition").then((p: any) => { if (p) { originX = p.x; originY = p.y; } });
  api.invoke("notch:getPosition").then((p: any) => { if (p) { startWX = p.x; startWY = p.y; dragReady = true; } });
  api.invoke("notch:setIgnoreMouse", false);
  e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
  if ((!dragPending && !isDragging) || !dragReady) return;
  const dx = e.screenX - startSX, dy = e.screenY - startSY;
  if (dragPending && !isDragging) {
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return; // threshold
    isDragging = true; dragPending = false; refs.shape.classList.add("dragging");
  }
  if (!isDragging) return;
  const nx = startWX + dx, ny = startWY + dy;
  if (dragRAF) cancelAnimationFrame(dragRAF);
  dragRAF = requestAnimationFrame(() => { api.invoke("notch:move", nx, ny); dragRAF = null; });
  refs.shape.classList.toggle("near-snap", snapDistance({ x: nx, y: ny }, { x: originX, y: originY }) <= NOTCH.SNAP_PX);
});

document.addEventListener("mouseup", (e) => {
  if (dragPending) { // a header click with no drag → expand if collapsed
    dragPending = false;
    if (morph === "collapsed") expand();
    restoreClickThroughIfOutside(e);
    return;
  }
  if (!isDragging) return;
  isDragging = false;
  refs.shape.classList.remove("dragging", "near-snap");
  const dx = e.screenX - startSX, dy = e.screenY - startSY;
  const fx = startWX + dx, fy = startWY + dy;
  if (snapDistance({ x: fx, y: fy }, { x: originX, y: originY }) <= NOTCH.SNAP_PX) {
    pinned = true;
    api.invoke("notch:move", originX, originY);
    api.invoke("notch:setPinned", true);
  } else {
    pinned = false;
    api.invoke("notch:setPinned", false);
  }
  refs.shape.classList.toggle("floating", !pinned);
  restoreClickThroughIfOutside(e);
});

// ---- resize (right/bottom handles) ----
let resizing: "right" | "bottom" | null = null;
let rStartSX = 0, rStartSY = 0, rStartW = 0, rStartH = 0;
let resizeRAF: number | null = null;

function beginResize(mode: "right" | "bottom", e: MouseEvent) {
  if (e.button !== 0 || morph !== "expanded") return;
  resizing = mode;
  rStartSX = e.screenX; rStartSY = e.screenY; rStartW = size.width; rStartH = size.height;
  refs.shape.classList.add("resizing");
  api.invoke("notch:setIgnoreMouse", false);
  e.preventDefault(); e.stopPropagation();
}
refs.resizeRight.addEventListener("mousedown", (e) => beginResize("right", e));
refs.resizeBottom.addEventListener("mousedown", (e) => beginResize("bottom", e));

document.addEventListener("mousemove", (e) => {
  if (!resizing) return;
  const dx = e.screenX - rStartSX, dy = e.screenY - rStartSY;
  const next = resizing === "right"
    ? { width: rStartW + (pinned ? dx * 2 : dx), height: rStartH } // pinned stays centered → both sides
    : { width: rStartW, height: rStartH + dy };
  size = clampSize(next);
  if (resizeRAF) cancelAnimationFrame(resizeRAF);
  resizeRAF = requestAnimationFrame(() => { api.invoke("notch:resize", size.width, size.height); resizeRAF = null; });
  e.preventDefault();
});
document.addEventListener("mouseup", (e) => {
  if (!resizing) return;
  resizing = null;
  refs.shape.classList.remove("resizing");
  localStorage.setItem("notchSize", JSON.stringify(size));
  restoreClickThroughIfOutside(e);
});

// ---- global-shortcut + dashboard-continue relays ----
api.on("hotkey:askNow", () => actions.askNow());
api.on("notch:continueSession", (id: number) => { void continueSession(id); });
// Opacity is owned by config now; Settings edits it and main pushes changes here.
api.on("notch:setOpacity", (v: number) => { opacity = clampOpacity(v); applyOpacity(); });
// Global navigation shortcuts (registered in main) drive pagination + scroll here.
api.on("notch:page", (dir: string) => { dir === "prev" ? actions.prev() : actions.next(); });
api.on("notch:scroll", (dir: string) => {
  const amount = Math.max(60, refs.contentEl.clientHeight * 0.6);
  refs.contentEl.scrollBy({ top: dir === "up" ? -amount : amount, behavior: "smooth" });
});

// ---- startup ----
api.invoke("config:get").then((c: any) => { opacity = clampOpacity(c?.opacity ?? 1); applyOpacity(); });
api.invoke("notch:resize", size.width, size.height); // set the OS window to the persisted panel size
render();
