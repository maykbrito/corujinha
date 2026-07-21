// src/renderer/notch/ui.ts
//
// Builds the morphing notch shape once and returns the DOM refs the controller
// (main.ts) attaches morph/drag/resize/opacity/click-through listeners to. renderNotch
// updates the dynamic parts (status, current turn as markdown, pagination, opacity value).
import { pageFor } from "@shared/session/pagination";
import { renderMarkdown } from "@shared/notchMarkdown";
import type { Turn } from "@shared/types";
import {
  createElement, GripHorizontal, Plus, LayoutGrid, Settings,
  ChevronUp, ChevronDown, RefreshCw, Sparkles, SendHorizontal, Monitor, MonitorOff,
} from "lucide";

function setIcon(el: HTMLElement, node: Parameters<typeof createElement>[0]) {
  el.replaceChildren(createElement(node));
}

// Custom tooltip: one element appended to <body> (outside .notch-shape's overflow:hidden so
// it isn't clipped by the collapsed pill), positioned under whatever element is hovered.
function initTooltips(els: HTMLElement[]): void {
  let tip = document.querySelector<HTMLElement>(".notch-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "notch-tip";
    document.body.appendChild(tip);
  }
  const tipEl = tip;
  const show = (el: HTMLElement) => {
    const text = el.getAttribute("title");
    if (!text) return;
    tipEl.textContent = text;
    const rect = el.getBoundingClientRect();
    tipEl.style.left = `${rect.left + rect.width / 2}px`;
    tipEl.style.top = `${rect.bottom + 6}px`;
    tipEl.classList.add("show");
  };
  const hide = () => tipEl.classList.remove("show");
  for (const el of els) {
    el.addEventListener("mouseenter", () => show(el));
    el.addEventListener("mouseleave", hide);
    el.addEventListener("click", hide); // dismiss on action
  }
}

export interface NotchState {
  turns: Turn[];
  index: number;
  statusLabel: string;
}

export interface NotchActions {
  send(text: string): Promise<boolean>; // clears input only on true (spec §7)
  askNow(): void;
  newSession(): void;
  prev(): void;
  next(): void;
  openDashboard(): void;
  openSettings(): void;
  regenerate(): void; // re-answer the last question, keeping both (paginated)
  suggestFollowUps(): Promise<string[]>; // one text-only call -> up to 3 follow-up questions
}

export interface NotchRefs {
  shape: HTMLElement;
  header: HTMLElement;
  grip: HTMLElement;
  newBtn: HTMLElement;
  settingsBtn: HTMLElement;
  collapseBtn: HTMLElement;
  resizeRight: HTMLElement;
  resizeBottom: HTMLElement;
  input: HTMLInputElement;
  statusEl: HTMLElement;
  roleEl: HTMLElement;
  contentEl: HTMLElement;
  countEl: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  send: HTMLButtonElement;
  regenBtn: HTMLButtonElement;
  suggestBtn: HTMLButtonElement;
  chipsEl: HTMLElement;
  screenToggle: HTMLButtonElement;
  attachEl: HTMLElement;
}

let refs: NotchRefs | null = null;

export function buildNotch(root: HTMLElement, actions: NotchActions): NotchRefs {
  root.innerHTML = `
    <div class="notch-shape" id="shape">
      <div class="notch-header" id="header">
        <span class="notch-grip" id="grip" title="Drag to move"></span>
        <span class="notch-status" id="status"></span>
        <div class="notch-header-actions">
          <button class="notch-hbtn" id="new" title="New session"></button>
          <button class="notch-hbtn" id="dash" title="Dashboard"></button>
          <button class="notch-hbtn" id="settings" title="Settings"></button>
          <button class="notch-hbtn" id="collapse" title="Minimize"></button>
        </div>
      </div>
      <div class="notch-inner">
        <div class="notch-content-view">
          <div class="notch-turn">
            <span class="notch-role" id="role"></span>
            <div class="notch-content" id="content"></div>
          </div>
          <div class="notch-followups">
            <div class="notch-followup-actions">
              <button id="regen" class="notch-textbtn" title="Regenerate answer"></button>
              <button id="suggest" class="notch-textbtn" title="Suggest follow-up questions"></button>
              <div class="notch-nav">
                <button id="prev" title="Previous">‹</button>
                <span class="count" id="count"></span>
                <button id="next" title="Next">›</button>
              </div>
            </div>
            <div class="notch-chips" id="chips"></div>
          </div>
          <div class="notch-typebox">
            <button id="screenToggle" class="notch-screen-toggle" title="Send screen"></button>
            <div id="attach" class="notch-attach" hidden></div>
            <input id="msg" type="text" placeholder="Ask about your screen…" />
            <button id="send" class="primary" title="Send"></button>
          </div>
        </div>
      </div>
      <div class="notch-resize-handle right" id="resizeRight"></div>
      <div class="notch-resize-handle bottom" id="resizeBottom"></div>
    </div>`;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const r: NotchRefs = {
    shape: $("shape"), header: $("header"), grip: $("grip"),
    newBtn: $("new"), settingsBtn: $("settings"), collapseBtn: $("collapse"),
    resizeRight: $("resizeRight"), resizeBottom: $("resizeBottom"),
    input: $<HTMLInputElement>("msg"),
    statusEl: $("status"), roleEl: $("role"), contentEl: $("content"), countEl: $("count"),
    prev: $<HTMLButtonElement>("prev"), next: $<HTMLButtonElement>("next"), send: $<HTMLButtonElement>("send"),
    regenBtn: $<HTMLButtonElement>("regen"), suggestBtn: $<HTMLButtonElement>("suggest"), chipsEl: $("chips"),
    screenToggle: $<HTMLButtonElement>("screenToggle"), attachEl: $("attach"),
  };

  // Icons (Lucide). Tooltips come from each element's title attribute above.
  setIcon(r.grip, GripHorizontal);
  setIcon(r.newBtn, Plus);
  setIcon(root.querySelector<HTMLElement>("#dash")!, LayoutGrid);
  setIcon(r.settingsBtn, Settings);
  setCollapseIcon(r, false); // starts collapsed → shows "expand" affordance
  r.regenBtn.replaceChildren(createElement(RefreshCw), Object.assign(document.createElement("span"), { textContent: "Regenerate" }));
  r.suggestBtn.replaceChildren(createElement(Sparkles), Object.assign(document.createElement("span"), { textContent: "Follow-ups" }));
  setIcon(r.send, SendHorizontal);
  setScreenToggle(r, true); // default on; main.ts syncs from config at startup

  // Native tooltips don't render on a non-activating panel window, so drive our own from
  // each element's title attribute.
  initTooltips([r.grip, r.newBtn, root.querySelector<HTMLElement>("#dash")!, r.settingsBtn, r.collapseBtn, r.send, r.screenToggle]);

  const submit = async () => {
    const v = r.input.value.trim();
    if (!v) return;
    r.send.disabled = true;
    const ok = await actions.send(v);
    r.send.disabled = false;
    if (ok) r.input.value = ""; // keep the text on failure so the user can retry (spec §7)
    else r.input.focus();
  };

  r.send.addEventListener("click", submit);
  r.input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  r.prev.addEventListener("click", actions.prev);
  r.next.addEventListener("click", actions.next);
  r.newBtn.addEventListener("click", (e) => { e.stopPropagation(); actions.newSession(); });
  root.querySelector<HTMLElement>("#dash")!.addEventListener("click", (e) => { e.stopPropagation(); actions.openDashboard(); });
  r.settingsBtn.addEventListener("click", (e) => { e.stopPropagation(); actions.openSettings(); });
  r.regenBtn.addEventListener("click", () => actions.regenerate());
  r.suggestBtn.addEventListener("click", async () => {
    r.suggestBtn.disabled = true;
    try { renderChips(r, await actions.suggestFollowUps(), actions); }
    finally { r.suggestBtn.disabled = false; }
  });

  refs = r;
  return r;
}

// Render clickable follow-up chips; clicking one asks it (like a typed question) and clears the row.
function renderChips(r: NotchRefs, ideas: string[], actions: NotchActions): void {
  r.chipsEl.replaceChildren();
  for (const text of ideas) {
    const chip = document.createElement("button");
    chip.className = "notch-chip";
    chip.type = "button";
    chip.textContent = text;
    chip.title = text;
    chip.addEventListener("click", async () => {
      r.chipsEl.replaceChildren();
      await actions.send(text);
    });
    r.chipsEl.appendChild(chip);
  }
}

// Collapse/expand toggle icon reflects state: chevron-up = minimize (when expanded),
// chevron-down = expand (when collapsed).
export function setCollapseIcon(r: NotchRefs, expanded: boolean): void {
  setIcon(r.collapseBtn, expanded ? ChevronUp : ChevronDown);
  r.collapseBtn.title = expanded ? "Minimize" : "Expand";
}

// Send-screen toggle: monitor icon (on) with a green "live" dot, or monitor-off (dimmed).
export function setScreenToggle(r: NotchRefs, on: boolean): void {
  setIcon(r.screenToggle, on ? Monitor : MonitorOff);
  r.screenToggle.classList.toggle("on", on);
  r.screenToggle.title = on ? "Sending screen — click for text only" : "Text only — click to send screen";
}

// One-shot region attachment: a thumbnail shown IN PLACE OF the send-screen toggle
// (a region replaces the screen send — you can't send both). Click it to remove.
// Pass null to clear and restore the toggle.
export function renderAttach(r: NotchRefs, region: { dataUrl: string } | null, onRemove?: () => void): void {
  if (!region) {
    r.attachEl.hidden = true;
    r.attachEl.replaceChildren();
    r.screenToggle.hidden = false;
    return;
  }
  const thumb = document.createElement("img");
  thumb.className = "notch-attach-thumb";
  thumb.src = region.dataUrl;
  thumb.title = "Region attached — click to remove";
  thumb.addEventListener("click", (e) => { e.stopPropagation(); onRemove?.(); });
  r.attachEl.replaceChildren(thumb);
  r.attachEl.hidden = false;
  r.screenToggle.hidden = true;
}

export function renderNotch(root: HTMLElement, state: NotchState, actions: NotchActions): void {
  const r = refs ?? buildNotch(root, actions);
  const page = pageFor(state.turns, state.index);
  r.statusEl.textContent = state.statusLabel;
  r.roleEl.textContent = page.item ? page.item.role : "";
  r.contentEl.innerHTML = page.item ? renderMarkdown(page.item.text) : "<p>Ask about your screen to begin.</p>";
  r.countEl.textContent = page.total ? `${page.index + 1} / ${page.total}` : "";
  r.prev.disabled = !page.hasPrev;
  r.next.disabled = !page.hasNext;
  const hasAssistant = state.turns.some((t) => t.role === "assistant");
  r.regenBtn.disabled = !hasAssistant;
  r.suggestBtn.disabled = !hasAssistant;
}
