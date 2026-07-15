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
// Onboarding gate: Start stays disabled and shows a "Set up in Settings" prompt until a
// key exists. Checked on load and refreshed when main broadcasts key:changed after key:set.
let hasKey = false;
// Bumped on every start/stop so a Stop pressed *during* connect can invalidate the
// in-flight session and close it (otherwise it leaks a live mic after "stopped").
let startGeneration = 0;
// Sticky connect/token-mint error, shown even when idle; cleared on the next Start (Retry).
let errorLabel = "";
// Notice badge: persistent (screen not shared) or transient (capture failed) — auto-clears.
let badge = "";
let badgeTimer: ReturnType<typeof setTimeout> | null = null;

function render() {
  const state: NotchState = { turns, index, status, statusLabel, muted, hasKey, error: errorLabel, badge };
  renderNotch(root, state, actions);
}

// Show a badge for a few seconds, then revert to the persistent screen-share notice (if any).
function flashBadge(msg: string) {
  badge = msg;
  render();
  if (badgeTimer) clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => {
    badge = screenNotice;
    render();
  }, 3000);
}

// Persistent notice while a session runs without screen-recording permission (voice-only).
let screenNotice = "";

async function refreshKey() {
  const s = await api.invoke("key:status");
  hasKey = !!s?.hasKey;
  render();
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
    if (!hasKey) return; // onboarding gate — set a key in Settings first
    if (!tryTransition("start")) return;
    const gen = ++startGeneration;
    errorLabel = ""; // clear any prior failure — this press is the retry
    statusLabel = "connecting…";
    // Screen recording is optional: without it the conversation still works voice-only,
    // but we surface a persistent badge so the user knows the AI can't see the screen.
    try {
      const perm = await api.invoke("perm:status");
      screenNotice = perm?.screen === "granted" ? "" : "screen not shared — enable in Settings";
    } catch {
      screenNotice = "";
    }
    badge = screenNotice;
    render();
    try {
      const c = await startConverse({
        onAssistantText: (text) => pushTurn(makeTurn("assistant", text)),
        onUserText: (text) => pushTurn(makeTurn("user", text)),
        onStatus: (s) => {
          if (gen !== startGeneration) return; // ignore a superseded session
          if (s === "capture-failed") {
            flashBadge("screen capture failed — continuing voice-only");
            return;
          }
          statusLabel = s;
          render();
        },
      });
      if (gen !== startGeneration) {
        // Stop (or a new start) happened while connecting — close the now-orphaned
        // live session instead of leaking an open mic.
        await c.stop();
        return;
      }
      converse = c;
    } catch (e) {
      if (gen !== startGeneration) return; // a newer action owns the state
      // Failed to connect (token-mint failure, network, etc.) — fall back to idle and
      // surface a sticky error. Start is enabled again in idle, so it doubles as Retry.
      status = "idle";
      statusLabel = "";
      errorLabel = `couldn't connect: ${String(e)} — press Start to retry`;
      badge = "";
      screenNotice = "";
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
    startGeneration++; // invalidate any in-flight start
    await converse?.stop();
    converse = null;
    status = "idle"; // ready to start a new session
    statusLabel = "";
    muted = false;
    turns = [];
    index = 0;
    errorLabel = "";
    screenNotice = "";
    badge = "";
    if (badgeTimer) clearTimeout(badgeTimer);
    render();
  },
  mute(on) {
    muted = on;
    converse?.mute(on);
    render();
  },
  askNow() {
    converse?.askNow().catch(() => {});
  },
  sendText(t) {
    converse?.sendText(t).catch(() => {});
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
    api.invoke("window:openDashboard");
  },
};

function makeTurn(role: Turn["role"], text: string): Turn {
  return { id: Date.now(), sessionId: converse?.getSessionId() ?? 0, role, source: "voice", text, createdAt: Date.now() };
}

// Global-shortcut relays from main (session lives here, so these run in the renderer).
api.on("hotkey:askNow", () => actions.askNow());
api.on("hotkey:toggleMute", () => actions.mute(!muted));
// Lift the onboarding gate once a key is saved in Settings.
api.on("key:changed", refreshKey);

refreshKey();
render();
