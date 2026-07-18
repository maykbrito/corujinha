import type { ConfigData } from "@shared/types";
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  text: string;
  imageDataUrl?: string; // only meaningful on user messages
}

function toContent(m: ChatMessage) {
  if (!m.imageDataUrl) return m.text;
  return [
    { type: "text", text: m.text },
    { type: "image_url", image_url: { url: m.imageDataUrl } },
  ];
}

export async function ollamaChat(
  fetchImpl: typeof fetch,
  cfg: Pick<ConfigData, "ollamaUrl" | "model">,
  messages: ChatMessage[],
): Promise<string> {
  const url = `${cfg.ollamaUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const body = {
    model: cfg.model,
    stream: false,
    messages: messages.map((m) => ({ role: m.role, content: toContent(m) })),
  };
  let res: any;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`Ollama not reachable at ${cfg.ollamaUrl} — is it running? (${String(e)})`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama request failed: ${res.status} ${detail}`);
  }
  const json = await res.json();
  return json?.choices?.[0]?.message?.content ?? "";
}
