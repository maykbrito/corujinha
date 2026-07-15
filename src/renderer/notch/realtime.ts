// src/renderer/notch/realtime.ts
//
// WebRTC Realtime "Converse" session wrapper.
//
// Reconciled against @openai/agents-realtime@0.13.4 (installed):
//   - RealtimeAgent / RealtimeSession(agent, { transport:'webrtc', model, config })
//   - session.connect({ apiKey })            (ephemeral token.value)
//   - session.on('transport_event', ...)     -> raw server events (the tested seam)
//   - session.addImage(dataUrl, {triggerResponse})  (image injection; replaces the
//                                            plan's hand-rolled conversation.item.create)
//   - session.sendMessage(text) / session.mute(on) / session.close()
//   - tools registered via the SDK `tool()` helper so the model both SEES them and
//     receives a function_call_output (raw config.tools is overwritten by agent tools,
//     per realtimeSession.js:278 — declaring them only on `config` never reaches the model).
//
// The tested integration boundary is preserved: `mapServerEvent` drives all turn/summary
// persistence over the `history:*` IPC. Every capture failure is caught so a turn degrades
// to audio-only instead of throwing. `currentSessionId` is a mutable `let` for Chunk 8 reconnect.
import { RealtimeSession, RealtimeAgent, tool } from "@openai/agents-realtime";
import { mapServerEvent } from "@shared/session/realtimeEvents";

const api = (window as any).api;

export interface ConverseHooks {
  onAssistantText(text: string): void;
  onUserText(text: string): void;
  onStatus(s: string): void; // "connected" | "reconnecting" | "capture-failed" | ...
}

export async function startConverse(hooks: ConverseHooks) {
  const token = await api.invoke("token:mint");
  let currentSessionId: number = (await api.invoke("history:startSession", "gpt-realtime-2.1")).id;
  let lastCaptureId: number | null = null;

  // Assigned below once the session exists; the tool `execute` closures reference it,
  // but only run at conversation time, long after assignment.
  let session: RealtimeSession;

  // Capture the screen, persist a captures row immediately (empty summary = fallback),
  // inject the image. Never throws — signals the UI on failure and proceeds audio-only.
  async function captureAndInject(triggerResponse = false): Promise<void> {
    try {
      const shot = await api.invoke("capture:screen"); // { dataUrl, thumbPath }
      const cap = await api.invoke("history:addCapture", {
        sessionId: currentSessionId,
        turnId: null,
        thumbPath: shot.thumbPath,
        summary: "",
      });
      lastCaptureId = cap.id;
      session.addImage(shot.dataUrl, { triggerResponse });
    } catch {
      hooks.onStatus("capture-failed"); // proceed audio-only for this turn
    }
  }

  // note_screen: the model records what it sees. Persistence flows through the tested
  // mapServerEvent seam (below); this execute just acks so the model isn't left hanging.
  const noteScreen = tool({
    name: "note_screen",
    description:
      "Record a one-to-two sentence summary of what the user's screen currently shows. " +
      "Call this whenever you are given a new screenshot.",
    parameters: {
      type: "object",
      properties: { summary: { type: "string", description: "Brief description of the visible screen." } },
      required: ["summary"],
      additionalProperties: false,
    } as any,
    strict: false,
    execute: async () => "noted",
  });

  // capture_screen: the model asks for a fresh look. We capture + inject the image and
  // request a response, so the model answers using the new frame.
  const captureScreen = tool({
    name: "capture_screen",
    description: "Request a fresh screenshot of the user's screen when you need an updated look before answering.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    } as any,
    strict: false,
    execute: async () => {
      await captureAndInject(true);
      return "captured";
    },
  });

  const agent = new RealtimeAgent({
    name: "See-and-Talk",
    voice: "marin",
    instructions:
      "You are a Socratic study companion who can see the user's screen. Whenever you are given a " +
      "new screenshot, call note_screen(summary) with a one-to-two sentence description of what it " +
      "shows. Call capture_screen when you need a fresh look before answering. Keep replies concise.",
    tools: [noteScreen, captureScreen],
  });

  session = new RealtimeSession(agent, {
    transport: "webrtc",
    model: "gpt-realtime-2.1",
    config: {
      audio: {
        input: { turnDetection: { type: "semantic_vad" } },
        output: { voice: "marin" },
      },
    },
  });

  session.on("transport_event", (ev: any) => {
    void handleServerEvent(ev);
  });

  async function handleServerEvent(ev: any) {
    try {
      // Race mitigation: capture when the user STARTS speaking, so the image is already in
      // context by the time semantic_vad auto-creates the response after they stop.
      if (ev?.type === "input_audio_buffer.speech_started") {
        await captureAndInject(false);
        return;
      }

      const mapped = mapServerEvent(ev);
      if (!mapped) return;
      if (mapped.kind === "turn") {
        await api.invoke("history:addTurn", {
          sessionId: currentSessionId,
          role: mapped.role,
          source: mapped.source,
          text: mapped.text,
        });
        if (mapped.role === "assistant") hooks.onAssistantText(mapped.text);
        else hooks.onUserText(mapped.text);
      } else if (mapped.kind === "note_screen") {
        if (lastCaptureId != null) await api.invoke("history:setCaptureSummary", lastCaptureId, mapped.summary);
        else
          await api.invoke("history:addCapture", {
            sessionId: currentSessionId,
            turnId: null,
            thumbPath: "",
            summary: mapped.summary,
          });
      }
      // mapped.kind === "capture_screen" is handled inside the tool's execute (above),
      // which awaits the injection before the model responds — avoiding a duplicate response.
    } catch {
      /* never let a handler rejection go unhandled */
    }
  }

  await session.connect({ apiKey: token.value });
  hooks.onStatus("connected");

  return {
    getSessionId: () => currentSessionId,
    setSessionId: (id: number) => {
      currentSessionId = id;
    }, // used by reconnect (Chunk 8)
    async sendText(text: string) {
      await api.invoke("history:addTurn", { sessionId: currentSessionId, role: "user", source: "typed", text });
      hooks.onUserText(text); // surface the typed message in the notch, like voice turns
      await captureAndInject(false);
      session.sendMessage(text);
    },
    async askNow() {
      await captureAndInject(false);
      session.sendMessage("Please respond about what you currently see on my screen.");
    },
    mute(on: boolean) {
      session.mute(on);
    },
    pause() {
      session.mute(true);
    }, // pause == mute the mic; kept distinct for the Pause control + state machine
    resume() {
      session.mute(false);
    },
    async stop() {
      session.close();
      await api.invoke("history:endSession", currentSessionId);
    },
    _session: session,
    _setLastCaptureNull: () => {
      lastCaptureId = null;
    },
  };
}

export type Converse = Awaited<ReturnType<typeof startConverse>>;
