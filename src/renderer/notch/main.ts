// src/renderer/notch/main.ts
//
// Notch controller. Turn-based: lazily starts a Converse on first send, pushes user +
// assistant turns into the local list, keeps the pagination index on the newest turn,
// and relays the Ask-now global shortcut. No session state machine, no key gate.
import { renderNotch, type NotchState, type NotchActions } from "./ui";
import { startConverse, type Converse } from "./realtime";
import type { Turn } from "@shared/types";

const api = (window as any).api;
const root = document.getElementById("app")!;

let turns: Turn[] = [];
let index = 0;
let statusLabel = "";
let converse: Converse | null = null;
let turnSeq = 0; // monotonic local id for rendered turns (not the DB rowid)

function render() {
  const state: NotchState = { turns, index, statusLabel };
  renderNotch(root, state, actions);
}
function pushTurn(role: Turn["role"], text: string) {
  turns = [...turns, { id: ++turnSeq, sessionId: converse?.getSessionId() ?? 0, role, source: "typed", text, createdAt: Date.now() }];
  index = turns.length - 1;
  render();
}
async function ensureConverse(): Promise<Converse> {
  if (converse) return converse;
  converse = await startConverse({
    onUserText: (t) => pushTurn("user", t),
    onAssistantText: (t) => pushTurn("assistant", t),
    onStatus: (s) => { statusLabel = s === "capture-failed" ? "screen capture failed — text only" : s; render(); },
  });
  return converse;
}

const actions: NotchActions = {
  async send(text) {
    try { return await (await ensureConverse()).ask(text); }
    catch { return false; }
  },
  async askNow() { (await ensureConverse()).askNow().catch(() => {}); },
  prev() { index = Math.max(0, index - 1); render(); },
  next() { index = Math.min(turns.length - 1, index + 1); render(); },
  openDashboard() { api.invoke("window:openDashboard"); },
};

api.on("hotkey:askNow", () => actions.askNow());
render();
