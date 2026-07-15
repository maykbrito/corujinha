// src/main/tokenMinter.ts
import type { EphemeralToken } from "@shared/types";

export async function mintEphemeralToken(apiKey: string, model = "gpt-realtime-2.1"): Promise<EphemeralToken> {
  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ session: { type: "realtime", model } }),
  });
  if (!res.ok) throw new Error(`Token mint failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { value: string; expires_at: number };
  return { value: json.value, expiresAt: json.expires_at * 1000 };
}
