// src/shared/session/sessionState.ts
export type SessionStatus = "idle" | "active" | "paused" | "ended";
export type SessionAction = "start" | "pause" | "resume" | "stop";

const TABLE: Record<SessionStatus, Partial<Record<SessionAction, SessionStatus>>> = {
  idle: { start: "active" },
  active: { pause: "paused", stop: "ended" },
  paused: { resume: "active", stop: "ended" },
  ended: {},
};

export function transition(state: SessionStatus, action: SessionAction): SessionStatus {
  const next = TABLE[state][action];
  if (!next) throw new Error(`Invalid transition: ${action} from ${state}`);
  return next;
}
