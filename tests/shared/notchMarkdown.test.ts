import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../../src/shared/notchMarkdown";

describe("renderMarkdown", () => {
  it("escapes html", () => {
    expect(renderMarkdown("<script>")).toContain("&lt;script&gt;");
  });
  it("renders bold, italic, inline code", () => {
    expect(renderMarkdown("**b** *i* `c`")).toContain("<strong>b</strong>");
    expect(renderMarkdown("**b** *i* `c`")).toContain("<em>i</em>");
    expect(renderMarkdown("**b** *i* `c`")).toContain("<code>c</code>");
  });
  it("renders an unordered list", () => {
    const out = renderMarkdown("- one\n- two");
    expect(out).toContain("<ul>");
    expect(out).toContain("<li>one</li>");
  });
  it("renders a fenced code block, escaping its contents", () => {
    const out = renderMarkdown("```\n<b> & 'x'\n```");
    expect(out).toContain("<pre><code>");
    expect(out).toContain("&lt;b&gt;");
  });
  it("renders headings and paragraphs", () => {
    expect(renderMarkdown("# Title")).toContain("<h1>Title</h1>");
    expect(renderMarkdown("hello")).toContain("<p>hello</p>");
  });
});
