// Ported from Cody notch-bubble.html (renderMarkdown/renderInline/escapeHtml), stripped of
// the code-language-label and green-span features. Renders a safe subset of markdown.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "<em>$1</em>")
    .replace(/(?<!\w)_([^_]+)_(?!\w)/g, "<em>$1</em>");
}

export function renderMarkdown(text: string): string {
  if (!text) return "";
  const lines = text.split("\n");
  let html = "";
  let inUl = false, inOl = false, inCode = false;
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceIndex = line.indexOf("```");
    if (fenceIndex !== -1) {
      const before = line.slice(0, fenceIndex);
      const after = line.slice(fenceIndex + 3);
      if (!inCode) {
        if (inUl) { html += "</ul>"; inUl = false; }
        if (inOl) { html += "</ol>"; inOl = false; }
        if (before.trim()) html += "<p>" + renderInline(before.trim()) + "</p>";
        inCode = true;
        codeLines = [];
        if (after.trim()) { /* language label dropped */ }
      } else {
        if (before) codeLines.push(before);
        html += "<pre><code>" + escapeHtml(codeLines.join("\n")) + "</code></pre>";
        inCode = false;
        codeLines = [];
        if (after.trim()) lines.splice(i + 1, 0, after);
      }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }

    const trimmed = line.trim();
    if (!trimmed) {
      if (inUl) { html += "</ul>"; inUl = false; }
      if (inOl) { html += "</ol>"; inOl = false; }
      continue;
    }
    const ul = trimmed.match(/^[-*]\s+(.+)$/);
    if (ul) {
      if (inOl) { html += "</ol>"; inOl = false; }
      if (!inUl) { html += "<ul>"; inUl = true; }
      html += "<li>" + renderInline(ul[1]) + "</li>";
      continue;
    }
    const ol = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      if (inUl) { html += "</ul>"; inUl = false; }
      if (!inOl) { html += "<ol>"; inOl = true; }
      html += "<li>" + renderInline(ol[1]) + "</li>";
      continue;
    }
    if (inUl) { html += "</ul>"; inUl = false; }
    if (inOl) { html += "</ol>"; inOl = false; }

    const h3 = trimmed.match(/^###\s+(.+)$/); if (h3) { html += "<h3>" + renderInline(h3[1]) + "</h3>"; continue; }
    const h2 = trimmed.match(/^##\s+(.+)$/);  if (h2) { html += "<h2>" + renderInline(h2[1]) + "</h2>"; continue; }
    const h1 = trimmed.match(/^#\s+(.+)$/);   if (h1) { html += "<h1>" + renderInline(h1[1]) + "</h1>"; continue; }
    const bq = trimmed.match(/^>\s+(.+)$/);   if (bq) { html += "<blockquote>" + renderInline(bq[1]) + "</blockquote>"; continue; }

    html += "<p>" + renderInline(trimmed) + "</p>";
  }
  if (inCode) html += "<pre><code>" + escapeHtml(codeLines.join("\n")) + "</code></pre>";
  if (inUl) html += "</ul>";
  if (inOl) html += "</ol>";
  return html;
}
