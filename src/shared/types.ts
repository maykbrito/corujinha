// src/shared/types.ts
export type SessionMode = "converse"; // v2: "watch_along" | "call"
export type TurnRole = "user" | "assistant";
export type TurnSource = "voice" | "typed";

export interface Session { id: number; mode: SessionMode; model: string; startedAt: number; endedAt: number | null; status: "active" | "ended"; }
export interface Turn { id: number; sessionId: number; role: TurnRole; source: TurnSource; text: string; createdAt: number; }
export interface Capture { id: number; sessionId: number; turnId: number | null; thumbPath: string; summary: string; createdAt: number; }

export interface SearchHit { turnId: number | null; captureId: number | null; sessionId: number; snippet: string; createdAt: number; }

export interface ConfigData { ollamaUrl: string; model: string; hideFromCapture: boolean; }
export interface PermissionStatus { screen: "granted" | "denied" | "not-determined"; }
