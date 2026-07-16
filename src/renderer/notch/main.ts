// src/renderer/notch/main.ts
//
// Notch controller. Turn-based: lazily starts a Converse on first send, pushes user +
// assistant turns into the local list, keeps the pagination index on the newest turn,
// and relays the Ask-now global shortcut. Supports New (end + fresh) and Continue (resume
// a session from the Dashboard). No session state machine, no key gate.
import { renderNotch, type NotchState, type NotchActions } from "./ui";
import { startConverse, type Converse, type ConverseHooks } from "./realtime";
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

const actions: NotchActions = {
  async send(text) {
    try { return await (await ensureConverse()).ask(text); }
    catch { return false; }
  },
  async askNow() { (await ensureConverse()).askNow().catch(() => {}); },
  async newSession() {
    await converse?.stop().catch(() => {}); // end the current DB session
    converse = null;
    turns = [];
    index = 0;
    statusLabel = "";
    render();
  },
  prev() { index = Math.max(0, index - 1); render(); },
  next() { index = Math.min(turns.length - 1, index + 1); render(); },
  openDashboard() { api.invoke("window:openDashboard"); },
};

// Continue a session picked in the Dashboard: end the current one, reopen the chosen
// session, and render its turns. New Sends append to that same session.
async function continueSession(id: number) {
  await converse?.stop().catch(() => {}); // end whatever was active
  statusLabel = "";
  converse = await startConverse(hooks, { continueSessionId: id });
  turns = converse.loadedTurns;
  index = Math.max(0, turns.length - 1);
  render();
}

api.on("hotkey:askNow", () => actions.askNow());
api.on("notch:continueSession", (id: number) => { void continueSession(id); });
render();
