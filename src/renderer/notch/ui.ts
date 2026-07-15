// src/renderer/notch/ui.ts
//
// Live notch UI. Builds the DOM shell once (so the type box keeps focus/value across
// re-renders) and updates the dynamic parts on every `renderNotch` call. The current
// turn is chosen by the tested `pageFor`; nav buttons follow its hasPrev/hasNext flags.
import { pageFor } from "@shared/session/pagination";
import type { SessionStatus } from "@shared/session/sessionState";
import type { Turn } from "@shared/types";

export interface NotchState {
  turns: Turn[];
  index: number;
  status: SessionStatus;
  statusLabel: string; // free-form connection status ("connected", "reconnecting", ...)
  muted: boolean;
}

export interface NotchActions {
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  mute(on: boolean): void;
  askNow(): void;
  sendText(t: string): void;
  prev(): void;
  next(): void;
  openDashboard(): void;
}

interface Refs {
  statusEl: HTMLElement;
  roleEl: HTMLElement;
  textEl: HTMLElement;
  countEl: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  start: HTMLButtonElement;
  pauseResume: HTMLButtonElement;
  stop: HTMLButtonElement;
  mute: HTMLButtonElement;
  ask: HTMLButtonElement;
  input: HTMLInputElement;
}

const cache = new WeakMap<HTMLElement, Refs>();

function build(root: HTMLElement, actions: NotchActions): Refs {
  root.innerHTML = `
    <div id="panel">
      <div class="row top">
        <span id="status" class="status"></span>
        <a id="dash" class="link nodrag" href="#">dashboard</a>
      </div>
      <div class="turn">
        <span id="role" class="role"></span>
        <div id="text" class="text"></div>
      </div>
      <div class="row nav">
        <button id="prev" class="nodrag">‹</button>
        <span id="count" class="count"></span>
        <button id="next" class="nodrag">›</button>
      </div>
      <div class="row controls">
        <button id="start" class="nodrag primary">Start</button>
        <button id="pauseResume" class="nodrag">Pause</button>
        <button id="stop" class="nodrag">Stop</button>
        <button id="mute" class="nodrag">Mute</button>
        <button id="ask" class="nodrag">Ask now</button>
      </div>
      <div class="row typebox">
        <input id="msg" class="nodrag" type="text" placeholder="Type a message…" />
      </div>
    </div>`;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const refs: Refs = {
    statusEl: $("status"),
    roleEl: $("role"),
    textEl: $("text"),
    countEl: $("count"),
    prev: $<HTMLButtonElement>("prev"),
    next: $<HTMLButtonElement>("next"),
    start: $<HTMLButtonElement>("start"),
    pauseResume: $<HTMLButtonElement>("pauseResume"),
    stop: $<HTMLButtonElement>("stop"),
    mute: $<HTMLButtonElement>("mute"),
    ask: $<HTMLButtonElement>("ask"),
    input: $<HTMLInputElement>("msg"),
  };

  refs.prev.addEventListener("click", actions.prev);
  refs.next.addEventListener("click", actions.next);
  refs.start.addEventListener("click", actions.start);
  refs.pauseResume.addEventListener("click", () => {
    // Label reflects the action the button performs next.
    if (refs.pauseResume.textContent === "Resume") actions.resume();
    else actions.pause();
  });
  refs.stop.addEventListener("click", actions.stop);
  refs.ask.addEventListener("click", actions.askNow);
  refs.mute.addEventListener("click", () => actions.mute(refs.mute.dataset.on !== "true"));
  root.querySelector<HTMLElement>("#dash")!.addEventListener("click", (e) => {
    e.preventDefault();
    actions.openDashboard();
  });
  refs.input.addEventListener("focus", () => (window as any).api.invoke("notch:setFocusable", true));
  refs.input.addEventListener("blur", () => (window as any).api.invoke("notch:setFocusable", false));
  refs.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && refs.input.value.trim()) {
      actions.sendText(refs.input.value.trim());
      refs.input.value = "";
    }
  });

  cache.set(root, refs);
  return refs;
}

export function renderNotch(root: HTMLElement, state: NotchState, actions: NotchActions): void {
  const refs = cache.get(root) ?? build(root, actions);
  const page = pageFor(state.turns, state.index);

  refs.statusEl.textContent = state.status === "idle" ? "" : state.statusLabel;
  refs.roleEl.textContent = page.item ? page.item.role : "";
  refs.textEl.textContent = page.item ? page.item.text : "Press Start to begin.";
  refs.countEl.textContent = page.total ? `${page.index + 1} / ${page.total}` : "";

  refs.prev.disabled = !page.hasPrev;
  refs.next.disabled = !page.hasNext;

  const active = state.status === "active" || state.status === "paused";
  refs.start.disabled = active;
  refs.stop.disabled = !active;
  refs.pauseResume.disabled = !active;
  refs.pauseResume.textContent = state.status === "paused" ? "Resume" : "Pause";
  refs.mute.disabled = !active;
  refs.mute.dataset.on = state.muted ? "true" : "false";
  refs.mute.textContent = state.muted ? "Unmute" : "Mute";
  refs.ask.disabled = !active;
  refs.input.disabled = !active;
}
