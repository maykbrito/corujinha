// tests/session/realtimeEvents.test.ts
import { describe, it, expect } from "vitest";
import { mapServerEvent } from "../../src/shared/session/realtimeEvents";

describe("mapServerEvent", () => {
  it("maps a completed user audio transcription to a user voice turn", () => {
    const out = mapServerEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "hello there" });
    expect(out).toEqual({ kind: "turn", role: "user", source: "voice", text: "hello there" });
  });
  it("maps a completed assistant transcript to an assistant turn", () => {
    const out = mapServerEvent({ type: "response.output_audio_transcript.done", transcript: "hi!" });
    expect(out).toEqual({ kind: "turn", role: "assistant", source: "voice", text: "hi!" });
  });
  it("maps a note_screen function call to a summary intent", () => {
    const out = mapServerEvent({ type: "response.function_call_arguments.done", name: "note_screen", arguments: '{"summary":"a cache diagram"}', call_id: "c1" });
    expect(out).toEqual({ kind: "note_screen", summary: "a cache diagram", callId: "c1" });
  });
  it("maps a capture_screen function call to a capture intent", () => {
    const out = mapServerEvent({ type: "response.function_call_arguments.done", name: "capture_screen", arguments: "{}", call_id: "c2" });
    expect(out).toEqual({ kind: "capture_screen", callId: "c2" });
  });
  it("ignores unrelated events", () => {
    expect(mapServerEvent({ type: "response.output_audio.delta" })).toBeNull();
  });
});
