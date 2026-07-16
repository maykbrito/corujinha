// src/renderer/notch/ui.ts
//
// Notch UI: text field + Send + response display + prev/next pagination. Builds the DOM
// shell once (so the input keeps focus/value across re-renders) and updates dynamic parts
// on every render. The current turn is chosen by the tested `pageFor`.
import { pageFor } from "@shared/session/pagination";
import type { Turn } from "@shared/types";

export interface NotchState {
  turns: Turn[];
  index: number;
  statusLabel: string; // "thinking…" | "" | "error: …" | "screen capture failed — text only"
}
export interface NotchActions {
  send(text: string): Promise<boolean>; // resolves true if the turn succeeded (clears the field)
  askNow(): void;
  prev(): void;
  next(): void;
  openDashboard(): void;
}
interface Refs {
  statusEl: HTMLElement; roleEl: HTMLElement; textEl: HTMLElement; countEl: HTMLElement;
  prev: HTMLButtonElement; next: HTMLButtonElement; send: HTMLButtonElement; input: HTMLInputElement;
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
        <div id="text" class="text nodrag"></div>
      </div>
      <div class="row nav">
        <button id="prev" class="nodrag">‹</button>
        <span id="count" class="count"></span>
        <button id="next" class="nodrag">›</button>
      </div>
      <div class="row typebox">
        <input id="msg" class="nodrag" type="text" placeholder="Ask about your screen…" />
        <button id="send" class="nodrag primary">Send</button>
      </div>
    </div>`;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const refs: Refs = {
    statusEl: $("status"), roleEl: $("role"), textEl: $("text"), countEl: $("count"),
    prev: $<HTMLButtonElement>("prev"), next: $<HTMLButtonElement>("next"),
    send: $<HTMLButtonElement>("send"), input: $<HTMLInputElement>("msg"),
  };
  const submit = async () => {
    const v = refs.input.value.trim();
    if (!v) return;
    refs.send.disabled = true;
    const ok = await actions.send(v);
    refs.send.disabled = false;
    if (ok) refs.input.value = ""; // keep the text on failure so the user can retry (spec §7)
    else refs.input.focus();
  };
  refs.prev.addEventListener("click", actions.prev);
  refs.next.addEventListener("click", actions.next);
  refs.send.addEventListener("click", submit);
  refs.input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  root.querySelector<HTMLElement>("#dash")!.addEventListener("click", (e) => { e.preventDefault(); actions.openDashboard(); });
  cache.set(root, refs);
  return refs;
}

export function renderNotch(root: HTMLElement, state: NotchState, actions: NotchActions): void {
  const refs = cache.get(root) ?? build(root, actions);
  const page = pageFor(state.turns, state.index);
  refs.statusEl.textContent = state.statusLabel;
  refs.roleEl.textContent = page.item ? page.item.role : "";
  refs.textEl.textContent = page.item ? page.item.text : "Ask about your screen to begin.";
  refs.countEl.textContent = page.total ? `${page.index + 1} / ${page.total}` : "";
  refs.prev.disabled = !page.hasPrev;
  refs.next.disabled = !page.hasNext;
}
