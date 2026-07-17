// src/renderer/notch/ui.ts
//
// Builds the Cody-style morphing notch shape once and returns the DOM refs the controller
// (main.ts) attaches morph/drag/resize/opacity/click-through listeners to. renderNotch
// updates the dynamic parts (status, current turn as markdown, pagination, opacity value).
import { pageFor } from "@shared/session/pagination";
import { renderMarkdown } from "@shared/notchMarkdown";
import type { Turn } from "@shared/types";
import {
  createElement, GripHorizontal, Plus, LayoutGrid, Contrast,
  ChevronUp, ChevronDown, RefreshCw, Sparkles,
} from "lucide";

function setIcon(el: HTMLElement, node: Parameters<typeof createElement>[0]) {
  el.replaceChildren(createElement(node));
}

export interface NotchState {
  turns: Turn[];
  index: number;
  statusLabel: string;
  opacity: number; // 0.45..1, drives --notch-bg-opacity
}

export interface NotchActions {
  send(text: string): Promise<boolean>; // clears input only on true (spec §7)
  askNow(): void;
  newSession(): void;
  prev(): void;
  next(): void;
  openDashboard(): void;
  setOpacity(v: number): void;
  regenerate(): void; // re-answer the last question, keeping both (paginated)
  suggestFollowUps(): Promise<string[]>; // one text-only call -> up to 3 follow-up questions
}

export interface NotchRefs {
  shape: HTMLElement;
  header: HTMLElement;
  grip: HTMLElement;
  newBtn: HTMLElement;
  gearBtn: HTMLElement;
  collapseBtn: HTMLElement;
  resizeRight: HTMLElement;
  resizeBottom: HTMLElement;
  input: HTMLInputElement;
  opacitySlider: HTMLInputElement;
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
          <button class="notch-hbtn" id="gear" title="Opacity"></button>
          <button class="notch-hbtn" id="collapse" title="Minimize"></button>
        </div>
      </div>
      <div class="notch-inner">
        <div class="notch-content-view">
          <div class="notch-turn">
            <span class="notch-role" id="role"></span>
            <div class="notch-content" id="content"></div>
          </div>
          <div class="notch-nav">
            <button id="prev">‹</button>
            <span class="count" id="count"></span>
            <button id="next">›</button>
          </div>
          <div class="notch-followups">
            <div class="notch-followup-actions">
              <button id="regen" class="notch-textbtn" title="Regenerate answer"></button>
              <button id="suggest" class="notch-textbtn" title="Suggest follow-up questions"></button>
            </div>
            <div class="notch-chips" id="chips"></div>
          </div>
          <div class="notch-typebox">
            <input id="msg" type="text" placeholder="Ask about your screen…" />
            <button id="send" class="primary">Send</button>
          </div>
        </div>
        <div class="notch-settings-view">
          <label>Opacity</label>
          <input type="range" id="opacity" class="notch-opacity" min="0.45" max="1" step="0.05" />
        </div>
      </div>
      <div class="notch-resize-handle right" id="resizeRight"></div>
      <div class="notch-resize-handle bottom" id="resizeBottom"></div>
    </div>`;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const r: NotchRefs = {
    shape: $("shape"), header: $("header"), grip: $("grip"),
    newBtn: $("new"), gearBtn: $("gear"), collapseBtn: $("collapse"),
    resizeRight: $("resizeRight"), resizeBottom: $("resizeBottom"),
    input: $<HTMLInputElement>("msg"), opacitySlider: $<HTMLInputElement>("opacity"),
    statusEl: $("status"), roleEl: $("role"), contentEl: $("content"), countEl: $("count"),
    prev: $<HTMLButtonElement>("prev"), next: $<HTMLButtonElement>("next"), send: $<HTMLButtonElement>("send"),
    regenBtn: $<HTMLButtonElement>("regen"), suggestBtn: $<HTMLButtonElement>("suggest"), chipsEl: $("chips"),
  };

  // Icons (Lucide). Tooltips come from each element's title attribute above.
  setIcon(r.grip, GripHorizontal);
  setIcon(r.newBtn, Plus);
  setIcon(root.querySelector<HTMLElement>("#dash")!, LayoutGrid);
  setIcon(r.gearBtn, Contrast);
  setCollapseIcon(r, false); // starts collapsed → shows "expand" affordance
  r.regenBtn.replaceChildren(createElement(RefreshCw), Object.assign(document.createElement("span"), { textContent: "Regenerate" }));
  r.suggestBtn.replaceChildren(createElement(Sparkles), Object.assign(document.createElement("span"), { textContent: "Follow-ups" }));

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
  r.opacitySlider.addEventListener("input", () => actions.setOpacity(parseFloat(r.opacitySlider.value)));
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
  if (r.opacitySlider.value !== String(state.opacity)) r.opacitySlider.value = String(state.opacity);
}
