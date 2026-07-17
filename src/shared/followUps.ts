// src/shared/followUps.ts
// Pure parser for the model's follow-up suggestions: turn a raw multi-line reply into
// at most `max` clean, de-duplicated one-line questions. Strips list numbering/bullets and
// drops the "…" idle response some models emit when they have nothing to suggest.
export function parseFollowUps(raw: string, max = 3): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of (raw ?? "").split("\n")) {
    const cleaned = line
      .trim()
      .replace(/^[-*•]\s+/, "") // bullet
      .replace(/^\d+[.)]\s+/, "") // "1." / "1)"
      .replace(/^["'“”]|["'“”]$/g, "") // wrapping quotes
      .trim();
    if (!cleaned) continue;
    if (/^\.{2,}$|^…$/.test(cleaned)) continue; // idle protocol
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}
