// src/shared/session/realtimeEvents.ts
export type MappedEvent =
  | { kind: "turn"; role: "user" | "assistant"; source: "voice" | "typed"; text: string }
  | { kind: "note_screen"; summary: string; callId: string }
  | { kind: "capture_screen"; callId: string }
  | null;

export function mapServerEvent(ev: any): MappedEvent {
  switch (ev?.type) {
    case "conversation.item.input_audio_transcription.completed":
      return { kind: "turn", role: "user", source: "voice", text: ev.transcript ?? "" };
    case "response.output_audio_transcript.done":
      return { kind: "turn", role: "assistant", source: "voice", text: ev.transcript ?? "" };
    case "response.function_call_arguments.done": {
      const args = safeParse(ev.arguments);
      if (ev.name === "note_screen") return { kind: "note_screen", summary: args.summary ?? "", callId: ev.call_id };
      if (ev.name === "capture_screen") return { kind: "capture_screen", callId: ev.call_id };
      return null;
    }
    default:
      return null;
  }
}
function safeParse(s: string): any { try { return JSON.parse(s); } catch { return {}; } }
