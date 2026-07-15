// src/renderer/dashboard/main.ts
//
// History dashboard. On load it lists all sessions (so history is visible without searching).
// Clicking a session shows its full transcript AND the screenshots the AI saw (thumbnail +
// summary). The search box filters via history:search (raw text — HistoryStore sanitizes).
import type { SearchHit, Turn, Session, Capture } from "@shared/types";

const api = (window as any).api;

const searchEl = document.getElementById("search") as HTMLInputElement;
const resultsEl = document.getElementById("results")!;
const turnsEl = document.getElementById("turns")!;

let timer: ReturnType<typeof setTimeout> | undefined;

searchEl.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(refresh, 200);
});

// Default view (empty search): list every session. With a query: show matching sessions.
async function refresh() {
  const q = searchEl.value.trim();
  if (!q) {
    const sessions = (await api.invoke("history:listSessions")) as Session[];
    renderSessionList(sessions);
    return;
  }
  const hits = (await api.invoke("history:search", q)) as SearchHit[];
  renderResults(hits);
}

function renderSessionList(sessions: Session[]) {
  if (sessions.length === 0) {
    resultsEl.innerHTML = `<p class="empty">No conversations yet. Start one from the notch.</p>`;
    return;
  }
  resultsEl.innerHTML = "";
  for (const s of sessions) {
    const el = document.createElement("div");
    el.className = "session";
    const when = new Date(s.startedAt).toLocaleString();
    el.innerHTML =
      `<div class="session-head">Session #${s.id} · ${escapeHtml(s.mode)} · ${escapeHtml(when)}` +
      `<span class="tag">${s.status}</span></div>`;
    el.querySelector(".session-head")!.addEventListener("click", () => loadSession(s.id));
    resultsEl.appendChild(el);
  }
}

function renderResults(hits: SearchHit[]) {
  if (hits.length === 0) {
    resultsEl.innerHTML = `<p class="empty">No matches.</p>`;
    return;
  }
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
    el.querySelector(".session-head")!.addEventListener("click", () => loadSession(sessionId));
    resultsEl.appendChild(el);
  }
}

async function loadSession(sessionId: number) {
  const [turns, captures] = (await Promise.all([
    api.invoke("history:listTurns", sessionId),
    api.invoke("history:listCaptures", sessionId),
  ])) as [Turn[], Capture[]];

  turnsEl.innerHTML = `<h2>Session #${sessionId}</h2>`;

  if (turns.length === 0 && captures.length === 0) {
    turnsEl.innerHTML += `<p class="empty">Nothing recorded in this session.</p>`;
    return;
  }

  if (turns.length) {
    const transcript = document.createElement("div");
    transcript.innerHTML =
      `<h3>Transcript</h3>` +
      turns
        .map(
          (t) =>
            `<div class="turn ${t.role}"><span class="role">${t.role} · ${t.source}</span>` +
            `<span class="text">${escapeHtml(t.text)}</span></div>`,
        )
        .join("");
    turnsEl.appendChild(transcript);
  }

  if (captures.length) {
    const capWrap = document.createElement("div");
    capWrap.innerHTML = `<h3>What the AI saw (${captures.length})</h3>`;
    for (const c of captures) {
      const card = document.createElement("div");
      card.className = "capture";
      const summary = c.summary ? escapeHtml(c.summary) : "<i>(no summary recorded)</i>";
      card.innerHTML = `<img class="thumb" alt="screenshot" /><div class="cap-summary">${summary}</div>`;
      // Load the thumbnail lazily as a data URL (main restricts reads to the captures dir).
      api.invoke("capture:thumb", c.thumbPath).then((dataUrl: string | null) => {
        const img = card.querySelector("img")!;
        if (dataUrl) img.src = dataUrl;
        else img.replaceWith(Object.assign(document.createElement("div"), { className: "thumb missing", textContent: "image unavailable" }));
      });
      capWrap.appendChild(card);
    }
    turnsEl.appendChild(capWrap);
  }
}

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

refresh(); // show the session list on open
