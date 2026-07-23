import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolResult } from "../types.js";
import type { ToolContext } from "./context.js";
import { getBrowser, isGoogleBlockedUrl, ensureWarmedUp } from "./browser.js";

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

  // Same brand-new-profile problem google_search has: an untrusted profile
  // reads as bot traffic. visit_page can be the very first browser call in
  // a session just as easily as google_search can, so it needs the same
  // gate — a warmup that only lived in google_search let visit_page launch
  // straight past it.
  const warmup = await ensureWarmedUp(ctx, "visit_page");
  if (warmup) return warmup;

  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: 1365, height: 900 });
    const response = await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
    const finalUrl = page.url();

    // visit_page takes an arbitrary URL, so a model that was just told by
    // google_search to back off can end up here instead, pointed straight
    // at a google.com search URL — same bot-check interstitial, and it
    // deserves the same clear error rather than silently returning the
    // interstitial's text as if it were real page content.
    if (isGoogleBlockedUrl(finalUrl, response?.status())) {
      return {
        content:
          "Tool error: this page was blocked by Google's automated-traffic check. " +
          "Note: visit_page is not a workaround for google_search being blocked — both hit the same " +
          "protection. Wait, space out requests, or ask the user to search manually.\n",
        isError: true,
      };
    }

    // brief settle for late-rendering SPA content
    await new Promise((r) => setTimeout(r, 500));

    const { markdown, links } = (await page.evaluate(EXTRACT_PAGE_CONTENT_JS)) as {
      markdown: string;
      links: { text: string; href: string }[];
    };
    let content = markdown;
    // The extractor above only looks for HTML elements (h1-h6/p/li/etc) —
    // an RSS/XML feed, a JSON API response, or a plain-text file has none
    // of those, so it comes back empty even though the page loaded fine.
    // Falling back to the raw response body covers all of those cases at
    // once without needing to sniff content-type (which isn't always
    // present or accurate) — only kicks in when the HTML-shaped extraction
    // genuinely found nothing to show.
    if (!content.trim() && response) {
      content = await response.text().catch(() => content);
    }
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
  const outputPath = path.join(tmpdir(), `core-agent-web-${Date.now()}`);
  writeFileSync(outputPath, markdown, "utf-8");
  const head = lines.slice(0, HEAD_LINES).join("\n").slice(0, HEAD_BYTES);
  return {
    content: `<head -${HEAD_LINES} ${outputPath}>\n${head}\n</head>\nUse read path=${outputPath} to see the rest.\n`,
  };
}
