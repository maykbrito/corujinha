import { describe, it, expect } from "vitest";
import { ollamaChat, type ChatMessage } from "../../src/main/ollama/ollamaClient";

const cfg = { ollamaUrl: "http://localhost:11434", model: "gemma4:26b" };

function okFetch(captured: { body?: any; url?: string }) {
  return (async (url: string, init: any) => {
    captured.url = url;
    captured.body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: "hi there" } }] }) };
  }) as unknown as typeof fetch;
}

describe("ollamaChat", () => {
  it("posts to the OpenAI-compatible endpoint and returns the assistant text", async () => {
    const cap: { body?: any; url?: string } = {};
    const msgs: ChatMessage[] = [{ role: "user", text: "what is this?" }];
    const out = await ollamaChat(okFetch(cap), cfg, msgs);
    expect(out).toBe("hi there");
    expect(cap.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(cap.body.model).toBe("gemma4:26b");
    expect(cap.body.messages[0]).toEqual({ role: "user", content: "what is this?" });
  });

  it("encodes an image message as an OpenAI content array", async () => {
    const cap: { body?: any } = {};
    const msgs: ChatMessage[] = [{ role: "user", text: "read this", imageDataUrl: "data:image/webp;base64,AAA" }];
    await ollamaChat(okFetch(cap), cfg, msgs);
    expect(cap.body.messages[0].content).toEqual([
      { type: "text", text: "read this" },
      { type: "image_url", image_url: { url: "data:image/webp;base64,AAA" } },
    ]);
  });

  it("maps a connection failure to a clear error", async () => {
    const boom = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    await expect(ollamaChat(boom, cfg, [{ role: "user", text: "x" }]))
      .rejects.toThrow(/Ollama not reachable at http:\/\/localhost:11434/);
  });

  it("throws on a non-ok HTTP response with the status", async () => {
    const bad = (async () => ({ ok: false, status: 404, text: async () => "model not found" })) as unknown as typeof fetch;
    await expect(ollamaChat(bad, cfg, [{ role: "user", text: "x" }]))
      .rejects.toThrow(/404/);
  });
});
