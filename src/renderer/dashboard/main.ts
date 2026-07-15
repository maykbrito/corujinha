// src/renderer/dashboard/main.ts
//
// History dashboard. Debounced search calls `history:search` (raw text — the tested
// HistoryStore.search sanitizes via toFtsMatch, so no per-caller escaping). Hits are
// grouped by session; clicking a session loads its full transcript via history:listTurns.
import type { SearchHit, Turn } from "@shared/types";

const api = (window as any).api;

const searchEl = document.getElementById("search") as HTMLInputElement;
const resultsEl = document.getElementById("results")!;
const turnsEl = document.getElementById("turns")!;

let timer: ReturnType<typeof setTimeout> | undefined;

searchEl.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(runSearch, 200);
});

async function runSearch() {
  const q = searchEl.value.trim();
  if (!q) {
    resultsEl.innerHTML = "";
    return;
  }
  const hits = (await api.invoke("history:search", q)) as SearchHit[];
  renderResults(hits);
}

function renderResults(hits: SearchHit[]) {
  if (hits.length === 0) {
    resultsEl.innerHTML = `<p class="empty">No matches.</p>`;
    return;
  }
  // Group snippets by session, newest sessions first.
  const bySession = new Map<number, SearchHit[]>();
  for (const h of hits) {
    const arr = bySession.get(h.sessionId) ?? [];
    arr.push(h);
    bySession.set(h.sessionId, arr);
  }
  resultsEl.innerHTML = "";
  for (const [sessionId, group] of bySession) {
    const el = document.createElement("div");
    el.className = "session";
    el.innerHTML =
      `<div class="session-head">Session #${sessionId} · ${group.length} hit(s)</div>` +
      group.map((h) => `<div class="snippet">${escapeHtml(h.snippet)}</div>`).join("");
    el.querySelector(".session-head")!.addEventListener("click", () => loadTurns(sessionId));
    resultsEl.appendChild(el);
  }
}

async function loadTurns(sessionId: number) {
  const turns = (await api.invoke("history:listTurns", sessionId)) as Turn[];
  if (turns.length === 0) {
    turnsEl.innerHTML = `<p class="empty">No turns in this session.</p>`;
    return;
  }
  turnsEl.innerHTML =
    `<h2>Session #${sessionId}</h2>` +
    turns
      .map(
        (t) =>
          `<div class="turn ${t.role}"><span class="role">${t.role}</span>` +
          `<span class="text">${escapeHtml(t.text)}</span></div>`,
      )
      .join("");
}

// The snippet from FTS5 already wraps matches in [ ]; escape everything else so raw
// transcript text can't inject markup.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
