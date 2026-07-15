// src/renderer/notch/main.ts
//
// Notch controller. Holds the session status (via the tested `transition()` state machine)
// and the local turn list, wires UI actions to the Realtime session wrapper, and re-renders.
import { renderNotch, type NotchState, type NotchActions } from "./ui";
import { startConverse, type Converse } from "./realtime";
import { transition, type SessionStatus } from "@shared/session/sessionState";
import type { Turn } from "@shared/types";

const api = (window as any).api;
const root = document.getElementById("app")!;

let status: SessionStatus = "idle";
let statusLabel = "";
let muted = false;
let turns: Turn[] = [];
let index = 0;
let converse: Converse | null = null;

function render() {
  const state: NotchState = { turns, index, status, statusLabel, muted };
  renderNotch(root, state, actions);
}

// Route a control press through the pure state machine; ignore invalid presses
// (e.g. Pause while idle) rather than throwing.
function tryTransition(action: Parameters<typeof transition>[1]): boolean {
  try {
    status = transition(status, action);
    return true;
  } catch {
    return false;
  }
}

function pushTurn(t: Turn) {
  turns = [...turns, t];
  index = turns.length - 1; // jump to newest
  render();
}

const actions: NotchActions = {
  async start() {
    if (!tryTransition("start")) return;
    statusLabel = "connecting…";
    render();
    try {
      converse = await startConverse({
        onAssistantText: (text) => pushTurn(makeTurn("assistant", text)),
        onUserText: (text) => pushTurn(makeTurn("user", text)),
        onStatus: (s) => {
          statusLabel = s;
          render();
        },
      });
    } catch (e) {
      // Failed to connect (no key, mint failure, etc.) — fall back to idle.
      status = "idle";
      statusLabel = `error: ${String(e)}`;
      converse = null;
      render();
    }
  },
  pause() {
    if (!tryTransition("pause")) return;
    converse?.pause();
    render();
  },
  resume() {
    if (!tryTransition("resume")) return;
    converse?.resume();
    render();
  },
  async stop() {
    if (!tryTransition("stop")) return;
    await converse?.stop();
    converse = null;
    status = "idle"; // ready to start a new session
    statusLabel = "";
    muted = false;
    turns = [];
    index = 0;
    render();
  },
  mute(on) {
    muted = on;
    converse?.mute(on);
    render();
  },
  askNow() {
    converse?.askNow();
  },
  sendText(t) {
    converse?.sendText(t);
  },
  prev() {
    index = Math.max(0, index - 1);
    render();
  },
  next() {
    index = Math.min(turns.length - 1, index + 1);
    render();
  },
  openDashboard() {
    // Wired in Chunk 7 (dashboard window).
  },
};

function makeTurn(role: Turn["role"], text: string): Turn {
  return { id: Date.now(), sessionId: converse?.getSessionId() ?? 0, role, source: "voice", text, createdAt: Date.now() };
}

render();
