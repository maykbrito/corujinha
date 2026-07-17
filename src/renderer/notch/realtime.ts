// src/renderer/notch/realtime.ts
// Local turn pipeline: capture screen + send text to Ollama, return assistant text.
// No WebRTC, no live session — one request per Send.
import type { Turn } from "@shared/types";
import { parseFollowUps } from "@shared/followUps";
const api = (window as any).api;

const CONTEXT_TURNS = 10; // resend last N turns (text only) for continuity

export interface ConverseHooks {
  onUserText(text: string): void;
  onAssistantText(text: string): void;
  onStatus(s: string): void; // "thinking…" | "" | "error: …"
}

export interface ConverseOptions {
  continueSessionId?: number; // reopen + resume this existing session instead of creating a new one
}

export async function startConverse(hooks: ConverseHooks, opts: ConverseOptions = {}) {
  const cfg = await api.invoke("config:get"); // { ollamaUrl, model }
  const context: Array<{ role: "user" | "assistant"; text: string }> = [];
  let sessionId: number;
  let loadedTurns: Turn[] = [];

  if (opts.continueSessionId != null) {
    // Continue an existing session: reopen it, load its turns, seed context from them.
    sessionId = opts.continueSessionId;
    await api.invoke("history:reopenSession", sessionId);
    loadedTurns = (await api.invoke("history:listTurns", sessionId)) as Turn[];
    for (const t of loadedTurns) {
      if (t.role === "user" || t.role === "assistant") context.push({ role: t.role, text: t.text });
    }
  } else {
    sessionId = (await api.invoke("history:startSession", cfg.model)).id;
  }

  async function ask(text: string): Promise<boolean> {
    const q = text.trim();
    if (!q) return false;
    hooks.onUserText(q);
    await api.invoke("history:addTurn", { sessionId, role: "user", source: "typed", text: q });

    // Auto-capture; summary = the question text (inline), best-effort.
    let imageDataUrl: string | undefined;
    try {
      const shot = await api.invoke("capture:screen"); // { dataUrl, thumbPath }
      await api.invoke("history:addCapture", { sessionId, turnId: null, thumbPath: shot.thumbPath, summary: q });
      imageDataUrl = shot.dataUrl;
    } catch {
      hooks.onStatus("capture-failed"); // proceed text-only
    }

    context.push({ role: "user", text: q });
    const recent = context.slice(-CONTEXT_TURNS);
    // Only the current turn carries the image; prior turns go as text.
    const messages = recent.map((m, i) =>
      i === recent.length - 1 && imageDataUrl
        ? { role: m.role, text: m.text, imageDataUrl }
        : { role: m.role, text: m.text },
    );

    try {
      hooks.onStatus("thinking…");
      const reply: string = await api.invoke("ollama:chat", messages);
      await api.invoke("history:addTurn", { sessionId, role: "assistant", source: "typed", text: reply });
      context.push({ role: "assistant", text: reply });
      hooks.onAssistantText(reply);
      hooks.onStatus("");
      return true;
    } catch (e) {
      hooks.onStatus(`error: ${String(e)}`);
      return false;
    }
  }

  return {
    getSessionId: () => sessionId,
    loadedTurns, // turns preloaded when continuing a session ([] for a fresh session)
    ask,
    async askNow() { await ask("Describe what is currently on my screen."); },

    // Re-answer the last question, keeping both answers (main pushes a new turn → paginated).
    // Text-only regen: no fresh screenshot, just a new pass over the existing context.
    async regenerate(): Promise<boolean> {
      const lastUser = [...context].reverse().find((m) => m.role === "user");
      if (!lastUser) return false;
      // Context up to and including the last user message (drop a trailing assistant answer).
      const upTo = context[context.length - 1]?.role === "assistant" ? context.slice(0, -1) : context.slice();
      const messages = upTo.slice(-CONTEXT_TURNS).map((m) => ({ role: m.role, text: m.text }));
      try {
        hooks.onStatus("thinking…");
        const reply: string = await api.invoke("ollama:chat", messages);
        await api.invoke("history:addTurn", { sessionId, role: "assistant", source: "typed", text: reply });
        context.push({ role: "assistant", text: reply });
        hooks.onAssistantText(reply);
        hooks.onStatus("");
        return true;
      } catch (e) {
        hooks.onStatus(`error: ${String(e)}`);
        return false;
      }
    },

    // One text-only call: ask the model for up to 3 short follow-up questions. Not saved to history.
    async suggestFollowUps(): Promise<string[]> {
      if (!context.some((m) => m.role === "assistant")) return [];
      const messages = [
        ...context.slice(-CONTEXT_TURNS).map((m) => ({ role: m.role, text: m.text })),
        {
          role: "user" as const,
          text: "Suggest 3 short follow-up questions I could ask next. Reply with ONLY the questions, one per line, no numbering, no other text.",
        },
      ];
      try {
        const reply: string = await api.invoke("ollama:chat", messages);
        return parseFollowUps(reply);
      } catch {
        return [];
      }
    },

    async stop() { await api.invoke("history:endSession", sessionId); },
  };
}

export type Converse = Awaited<ReturnType<typeof startConverse>>;
