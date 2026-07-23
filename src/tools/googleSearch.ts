import type { ToolResult } from "../types.js";
import type { ToolContext } from "./context.js";
import { getBrowser, isGoogleBlockedUrl, ensureWarmedUp } from "./browser.js";

const NAV_TIMEOUT_MS = 25_000;
const CONSENT_PATTERNS = ["accept all", "すべて承諾", "i agree", "同意する"];

// See visitPage.ts for why this is a raw JS string rather than a TS function
// reference (tsx/esbuild's hard-coded keepNames breaks page.evaluate on
// nested named functions).
const CLICK_CONSENT_JS = `
(() => {
  const patterns = ${JSON.stringify(CONSENT_PATTERNS)};
  const buttons = Array.from(document.querySelectorAll("button, div[role='button']"));
  for (const btn of buttons) {
    const text = (btn.textContent || "").trim().toLowerCase();
    if (patterns.some((p) => text.includes(p))) {
      btn.click();
      return true;
    }
  }
  return false;
})()
`;

const EXTRACT_SEARCH_RESULTS_JS = `
(() => {
  const links = [];
  document.querySelectorAll("a[href]").forEach((a) => {
    const href = a.href;
    if (!href.startsWith("http")) return;
    if (/google\\.com|gstatic\\.com|googleusercontent\\.com/.test(href)) return;
    const text = (a.textContent || "").trim();
    if (!text) return;
    links.push({ text, href });
  });
  const snapshot = (document.body.innerText || "").slice(0, 1200);
  return { links: links.slice(0, 20), snapshot };
})()
`;

export async function toolGoogleSearch(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const query = args.query as string | undefined;
  if (!query) return { content: "Tool error: google_search requires query\n", isError: true };

  const warmup = await ensureWarmedUp(ctx, "google_search");
  if (warmup) return warmup;

  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    const response = await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
    const finalUrl = page.url();

    if (isGoogleBlockedUrl(finalUrl, response?.status())) {
      return {
        content:
          "Tool error: google_search was blocked by Google's automated-traffic check " +
          "(rate limited or flagged as a bot). Try again later, space out requests, or ask the user to search manually.\n",
        isError: true,
      };
    }

    const clicked = await page.evaluate(CLICK_CONSENT_JS);
    if (clicked) await new Promise((r) => setTimeout(r, 800));

    const { links, snapshot } = (await page.evaluate(EXTRACT_SEARCH_RESULTS_JS)) as {
      links: { text: string; href: string }[];
      snapshot: string;
    };

    const linksSection = links.map((l) => `- [${l.text}](${l.href})`).join("\n");
    const content =
      `# Google search results\n\nURL: ${url}\n\n## Visible links\n${linksSection}\n\n` +
      `## Text snapshot\n${snapshot}\n`;

    return { content };
  } catch (err: any) {
    return { content: `Tool error: google_search failed: ${err.message}\n`, isError: true };
  } finally {
    await page?.close().catch(() => {});
  }
}
