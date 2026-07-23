import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolResult } from "../types.js";
import type { ToolContext } from "./context.js";
import { getBrowser } from "./browser.js";

const NAV_TIMEOUT_MS = 25_000;
const MAX_CONTENT_CHARS = 900_000;
const HEAD_LINES = 100;
const HEAD_BYTES = 8 * 1024;

/**
 * Runs in the page context via page.evaluate(string). Kept as a raw JS
 * string (not a TS function reference) because tsx/esbuild hard-codes
 * keepNames:true, which injects `__name(...)` calls into nested named
 * functions; those calls end up inside the serialized source Puppeteer
 * ships to the browser, where no such helper exists, and the eval throws
 * "__name is not defined". A plain string is never run through that
 * transform, so it stays exactly what we wrote.
 */
const EXTRACT_PAGE_CONTENT_JS = `
(() => {
  function isVisible(el) {
    const s = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0" && r.width > 0 && r.height > 0;
  }
  const blocks = [];
  document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,td,th").forEach((el) => {
    if (!isVisible(el)) return;
    const text = (el.textContent || "").trim().replace(/\\s+/g, " ");
    if (!text) return;
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) blocks.push("#".repeat(Number(tag[1])) + " " + text);
    else if (tag === "li") blocks.push("- " + text);
    else if (tag === "pre") blocks.push("\`\`\`\\n" + text + "\\n\`\`\`");
    else if (tag === "blockquote") blocks.push("> " + text);
    else blocks.push(text);
  });
  const links = [];
  document.querySelectorAll("a[href]").forEach((a) => {
    if (!isVisible(a)) return;
    const text = (a.textContent || "").trim();
    const href = a.href;
    if (text.length >= 3 && href.startsWith("http")) links.push({ text, href });
  });
  return { markdown: blocks.join("\\n\\n"), links: links.slice(0, 80) };
})()
`;

export async function toolVisitPage(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const url = args.url as string | undefined;
  if (!url) return { content: "Tool error: visit_page requires url\n", isError: true };

  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: 1365, height: 900 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
    // brief settle for late-rendering SPA content
    await new Promise((r) => setTimeout(r, 500));

    const { markdown, links } = (await page.evaluate(EXTRACT_PAGE_CONTENT_JS)) as {
      markdown: string;
      links: { text: string; href: string }[];
    };
    let content = markdown;
    let truncated = false;
    if (content.length > MAX_CONTENT_CHARS) {
      content = content.slice(0, MAX_CONTENT_CHARS) + "\n[Content truncated by browser extractor.]";
      truncated = true;
    }

    const linkSection =
      links.length > 0
        ? "\n\n## Visible links\n" + links.map((l) => `- [${l.text}](${l.href})`).join("\n")
        : "";
    const fullMarkdown = `# ${url}\n\n${content}${linkSection}`;

    return formatWithHeadPattern(fullMarkdown, truncated);
  } catch (err: any) {
    return { content: `Tool error: visit_page failed: ${err.message}\n`, isError: true };
  } finally {
    await page?.close().catch(() => {});
  }
}

/** Same "head + spill to temp file" pattern used for the read tool, so a
 *  huge page doesn't blow the model's context budget. */
function formatWithHeadPattern(markdown: string, forceSpill: boolean): ToolResult {
  const bytes = Buffer.byteLength(markdown, "utf-8");
  const lines = markdown.split("\n");
  if (!forceSpill && bytes <= HEAD_BYTES && lines.length <= HEAD_LINES) {
    return { content: `<markdown>\n${markdown}\n</markdown>\n` };
  }
  const outputPath = path.join(tmpdir(), `my-agent-web-${Date.now()}`);
  writeFileSync(outputPath, markdown, "utf-8");
  const head = lines.slice(0, HEAD_LINES).join("\n").slice(0, HEAD_BYTES);
  return {
    content: `<head -${HEAD_LINES} ${outputPath}>\n${head}\n</head>\nUse read path=${outputPath} to see the rest.\n`,
  };
}
