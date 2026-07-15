// src/renderer/notch/realtime.ts
//
// WebRTC Realtime "Converse" session wrapper.
//
// Reconciled against @openai/agents-realtime@0.13.4 (installed):
//   - RealtimeAgent / RealtimeSession(agent, { transport:'webrtc', model, config })
//   - session.connect({ apiKey })            (ephemeral token.value)
//   - session.on('transport_event', ...)     -> raw server events (the tested seam)
//   - session.transport.on('connection_change', status) -> 'connecting'|'connected'|'disconnected'
//     The WebRTC transport does NOT auto-reconnect: on peer-connection failed/closed (or
//     'disconnected' past a grace period) it calls close(), which emits
//     connection_change('disconnected'). User Stop emits the SAME event, so a `stopped`
//     flag distinguishes a deliberate close from a real drop (openaiRealtimeWebRtc.mjs:344).
//   - session.addImage(dataUrl, {triggerResponse})  (image injection)
//   - session.sendMessage(text) / session.mute(on) / session.updateHistory(items) / session.close()
//   - tools registered via the SDK `tool()` helper so the model both SEES them and
//     receives a function_call_output.
//
// The tested integration boundary is preserved: `mapServerEvent` drives all turn/summary
// persistence over the `history:*` IPC. Every capture failure is caught so a turn degrades
// to audio-only instead of throwing. `currentSessionId` is a mutable `let` and is NEVER
// changed by reconnect — a dropped Realtime connection reconnects UNDER THE SAME DB session
// row so the Dashboard shows one continuous conversation.
import { RealtimeSession, RealtimeAgent, tool } from "@openai/agents-realtime";
import { mapServerEvent } from "@shared/session/realtimeEvents";

const api = (window as any).api;

// Reconnect backoff: exponential from BASE, capped, with a hard attempt ceiling so a
// permanently-dead network surfaces an error instead of spinning forever (storm guard).
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;
const RECONNECT_MAX_ATTEMPTS = 6;
const RECONNECT_SEED_TURNS = 10;

export interface ConverseHooks {
  onAssistantText(text: string): void;
  onUserText(text: string): void;
  onStatus(s: string): void; // "connected" | "reconnecting" | "capture-failed" | "reconnect-failed" | ...
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startConverse(hooks: ConverseHooks) {
  let currentSessionId: number = (await api.invoke("history:startSession", "gpt-realtime-2.1")).id;
  let lastCaptureId: number | null = null;
  // The user's mute intent, tracked so pause/resume — and reconnect — can't silently reopen a muted mic.
  let userMuted = false;
  // Whether the user has paused (mic muted, session warm). Tracked so a reconnect
  // while paused restores the muted mic instead of silently reopening it.
  let paused = false;
  // Set by stop() so a deliberate close doesn't trigger the reconnect path.
  let stopped = false;
  // Guards against overlapping reconnect loops (a failed reconnect fires connection_change again).
  let reconnecting = false;
  // Only reconnect a connection that was already live; a FAILED initial connect emits the same
  // 'disconnected' event but must surface as a start error, not spawn a background reconnect loop.
  let established = false;

  // Reassigned on every (re)connect; the tool `execute` closures and captureAndInject
  // reference this mutable binding, so they always target the live session.
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

  // note_screen: the model records what it sees. Persist the summary directly here (the SDK
  // delivers the parsed args to execute reliably), attaching it to the most recent capture.
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
    execute: async (input: any) => {
      const summary = typeof input?.summary === "string" ? input.summary : "";
      if (summary && lastCaptureId != null) {
        try {
          await api.invoke("history:setCaptureSummary", lastCaptureId, summary);
        } catch {
          /* best-effort */
        }
      }
      return "noted";
    },
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
      "You are a Socratic study companion who can see the user's screen. Every time you receive a " +
      "new screenshot, FIRST call note_screen(summary) with a one-to-two sentence description of what " +
      "is on screen (name key text, numbers, code, or UI you can read). Then answer. Read on-screen " +
      "numbers and text carefully and quote them exactly. Call capture_screen when you need a fresh " +
      "look before answering. Keep spoken replies concise.",
    tools: [noteScreen, captureScreen],
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

  // Build a fresh RealtimeSession wired with the same agent/config/handlers. Each new
  // session gets its own transport, so its listeners are attached here; the previous
  // session object is fully closed (see reconnect) so its listeners are not leaked.
  function buildSession(): RealtimeSession {
    const s = new RealtimeSession(agent, {
      transport: "webrtc",
      model: "gpt-realtime-2.1",
      config: {
        audio: {
          input: { turnDetection: { type: "semantic_vad" } },
          output: { voice: "marin" },
        },
      },
    });
    s.on("transport_event", (ev: any) => {
      void handleServerEvent(ev);
    });
    // The disconnect seam: fires on both user close() and a real drop; `stopped` tells them apart.
    s.transport.on("connection_change", (status: string) => {
      if (status === "disconnected") void handleDisconnect();
    });
    return s;
  }

  async function connectWithFreshToken(s: RealtimeSession): Promise<void> {
    const token = await api.invoke("token:mint");
    await s.connect({ apiKey: token.value });
  }

  // Seed a reconnected session with recent context so the model keeps continuity. Best-effort:
  // reads the last N turns of the SAME DB session and injects them as one system history item
  // (updateHistory does not trigger a spoken response, unlike sendMessage).
  async function seedRecentContext(): Promise<void> {
    try {
      const turns: Array<{ role: string; text: string }> = await api.invoke("history:listTurns", currentSessionId);
      const recent = turns.slice(-RECONNECT_SEED_TURNS);
      if (recent.length === 0) return;
      const summary = recent.map((t) => `${t.role}: ${t.text}`).join("\n");
      session.updateHistory([
        {
          itemId: `seed-${Date.now()}`,
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: `Earlier in this conversation (reconnected):\n${summary}` }],
        },
      ] as any);
    } catch {
      /* seeding is best-effort — a fresh reconnect without context is still usable */
    }
  }

  // Transparent reconnect under the SAME DB session row. Never mints a new sessions row and
  // never touches currentSessionId, so pre- and post-drop turns stay in one conversation.
  async function handleDisconnect(): Promise<void> {
    if (stopped || reconnecting || !established) return; // stop, reconnect in flight, or failed first connect
    reconnecting = true;
    hooks.onStatus("reconnecting");

    for (let attempt = 1; attempt <= RECONNECT_MAX_ATTEMPTS && !stopped; attempt++) {
      await sleep(Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS));
      if (stopped) break;
      try {
        const fresh = buildSession();
        await connectWithFreshToken(fresh);
        if (stopped) {
          // Stop landed mid-reconnect — discard the session we just opened.
          fresh.close();
          break;
        }
        session = fresh;
        established = true;
        if (userMuted || paused) session.mute(true); // never reopen a mic the user muted/paused
        await seedRecentContext();
        reconnecting = false;
        hooks.onStatus("connected");
        return;
      } catch {
        /* connect failed — fall through to the next backoff attempt */
      }
    }

    reconnecting = false;
    if (!stopped) hooks.onStatus("reconnect-failed"); // gave up after the attempt ceiling
  }

  session = buildSession();
  await connectWithFreshToken(session);
  established = true;
  hooks.onStatus("connected");

  return {
    getSessionId: () => currentSessionId,
    setSessionId: (id: number) => {
      currentSessionId = id;
    }, // reserved for future modes; v1 reconnect leaves currentSessionId untouched
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
      userMuted = on;
      session.mute(on);
    },
    pause() {
      paused = true;
      session.mute(true);
    }, // pause == mute the mic; kept distinct for the Pause control + state machine
    resume() {
      paused = false;
      // Restore the user's mute intent — never force the mic open on resume.
      session.mute(userMuted);
    },
    async stop() {
      stopped = true; // must precede close() so the connection_change handler skips reconnect
      session.close();
      await api.invoke("history:endSession", currentSessionId);
    },
  };
}

export type Converse = Awaited<ReturnType<typeof startConverse>>;
