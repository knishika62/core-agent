import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { requireConfirmation, type ToolContext } from "./context.js";
import { color } from "../cliColors.js";
import type { ToolResult } from "../types.js";

function chromeCandidates(): string[] {
  if (process.platform === "darwin") {
    return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  }
  if (process.platform === "win32") {
    const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const localAppData = process.env["LOCALAPPDATA"] ?? "";
    return [
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      // Per-user installs (no admin rights) land under %LOCALAPPDATA% instead.
      ...(localAppData ? [path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe")] : []),
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome",
  ];
}

/** Mirrors ds4_web.c's web_chrome_executable(): reuse the machine's installed
 *  Chrome instead of bundling/downloading a private Chromium. */
function findChromeExecutable(): string {
  const env = process.env.CORE_AGENT_CHROME;
  if (env) return env;

  for (const c of chromeCandidates()) if (existsSync(c)) return c;
  throw new Error(
    "Could not find a Chrome install. Set CORE_AGENT_CHROME to the Chrome executable path.",
  );
}

/**
 * A brand-new, cookie-less Chrome profile is a strong bot signal to Google
 * and gets CAPTCHA'd almost immediately. That's a one-time bootstrap cost,
 * not a design flaw: ds4_agent's own ~/.ds4/browser profile only looks
 * "trusted" today because it accumulated real cookies/session state over
 * months of actual use — the same thing happens here once this project's
 * own persistent profile (~/.core-agent/browser) sees real use.
 *
 * Deliberately NOT seeded from ds4's profile: this project is meant to
 * stand on its own (that's the whole point of the rewrite), and depending
 * on another local project's browser state would only work on this one
 * machine, for this one user, for as long as ds4_agent keeps being run to
 * keep it warm. Point CORE_AGENT_CHROME_PROFILE at any existing profile
 * (including ds4's) if you want to bootstrap manually — but that's an
 * explicit opt-in, not the default.
 */
function findProfileDir(): string {
  const env = process.env.CORE_AGENT_CHROME_PROFILE;
  if (env) return env;
  return path.join(homedir(), ".core-agent", "browser");
}

/** Must be called before getBrowser() — puppeteer.launch() creates the
 *  profile directory as a side effect, so this only tells the truth if
 *  checked first. */
export function isFreshProfile(): boolean {
  return !existsSync(findProfileDir());
}

let browserPromise: Promise<Browser> | null = null;
let warned = false;
let warmupClosedPromise: Promise<void> | null = null;

function waitForWarmupClose(): Promise<void> {
  return warmupClosedPromise ?? Promise.resolve();
}

function beginWarmup(page: Page): Promise<void> {
  warmupClosedPromise = new Promise((resolve) => {
    page.once("close", () => resolve());
  });
  return warmupClosedPromise;
}

/**
 * Shared by google_search and visit_page: either can end up being the
 * first browser call in a session (a model asked to search might reach for
 * visit_page instead, or use it beforehand for something unrelated), so the
 * warmup gate has to apply no matter which tool triggers it first — a gate
 * that only lived inside google_search let visit_page slip straight past
 * it on a still brand-new, untrusted profile.
 *
 * Deliberately blocks *inside* this call rather than returning a "please
 * wait" tool result and handing control back to the model: a model handed
 * a "still warming up" message has room to decide waiting is optional and
 * answer from memory/earlier context instead, which is worse than no
 * answer at all. Blocking here means there's no intermediate turn where
 * that choice exists — the model's tool call just doesn't return until the
 * human closes the window, at which point the *real* result comes back in
 * that same call.
 *
 * Returns a ToolResult the caller should return immediately (the user
 * declined to open the warmup window), or null once the profile is warmed
 * up and the caller should proceed with its real work.
 */
export async function ensureWarmedUp(ctx: ToolContext, toolName: string): Promise<ToolResult | null> {
  if (warmupClosedPromise) {
    await waitForWarmupClose();
    console.error(color.success(`[${toolName}] Warmup window closed — continuing with the original request now.`));
    return null;
  }

  if (!isFreshProfile()) return null;

  // Printed directly (not just returned as the tool result) and *before*
  // the browser opens: a popping-up Chrome window can cover the terminal
  // and steal focus instantly, so if the explanation only showed up in the
  // tool-result log afterward, it was easy to miss entirely.
  console.error(
    color.error(
      `\n[${toolName}] This browser profile is brand new — Google will likely flag automated ` +
        "access from it as bot traffic. A visible Chrome window is about to open. Please browse " +
        "normally in it for a couple of minutes (visit a few sites, optionally sign into your " +
        "Google account), then close that window — the original request will be answered " +
        "automatically once you do. This is a one-time setup step.\n",
    ),
  );
  const denied = await requireConfirmation(ctx, toolName, "Open a visible Chrome window for one-time profile warmup?");
  if (denied) return denied;

  const browser = await getBrowser();
  const page = await browser.newPage();
  const closed = beginWarmup(page);
  await page.goto("https://www.google.com/", { waitUntil: "domcontentloaded" }).catch(() => {});
  console.error(color.dim(`[${toolName}] Waiting for the warmup window to close before continuing...`));
  await closed;
  // Don't wait for the Chrome *process* to exit on its own: on macOS an app
  // can (and, observed in practice, does) keep running with zero windows
  // open after the user closes the last one — nothing else was going to
  // make it quit, so the profile directory's lock file never gets
  // released, and relaunching against the same userDataDir fails with
  // "browser is already running". Force it closed here instead, so the
  // next getBrowser() call is guaranteed a clean profile lock to launch
  // against rather than hoping the OS tears the process down first.
  await browser.close().catch(() => {});
  browserPromise = null;
  warmupClosedPromise = null;
  console.error(color.success(`[${toolName}] Warmup window closed — continuing with the original request now.`));
  return null;
}

/** Even after waiting for "disconnected" in ensureWarmedUp, the OS can lag
 *  a little further behind releasing the profile directory's lock file —
 *  retrying a few times with a short pause covers that remaining gap
 *  without needing an even longer, purely speculative fixed delay. */
async function launchWithRetry(profileDir: string): Promise<Browser> {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await puppeteer.launch({
        executablePath: findChromeExecutable(),
        headless: process.env.CORE_AGENT_CHROME_HEADLESS === "1",
        userDataDir: profileDir,
        args: ["--remote-allow-origins=*"],
      });
    } catch (err: any) {
      const isLockConflict = String(err?.message ?? err).includes("already running");
      if (!isLockConflict || attempt === maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error("unreachable");
}

export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const profileDir = findProfileDir();
    if (!warned) {
      warned = true;
      console.error(`[core-agent] launching Chrome for a web tool (profile: ${profileDir})...`);
    }
    const launched = launchWithRetry(profileDir);
    browserPromise = launched;
    // Closing the warmup window (or any last remaining window) quits the
    // whole Chrome process, not just that one page — "page close" fires,
    // but the Browser itself also goes away. Without this, the cached
    // promise above keeps pointing at that now-dead Browser forever, so
    // every later getBrowser() call hands back a connection nothing can
    // actually open new pages on, and no window ever opens again. Clearing
    // the cache here means the next call relaunches instead.
    launched.then((browser) => {
      browser.once("disconnected", () => {
        if (browserPromise === launched) browserPromise = null;
      });
    });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}

/**
 * Shared between google_search (which navigates to google.com/search
 * directly) and visit_page (which the model can point at *any* URL,
 * including a google.com search URL as an ad-hoc workaround when told to
 * back off google_search) — either path can land on Google's automated-
 * traffic interstitial, and both should report that clearly instead of
 * silently returning the interstitial's text as if it were real content.
 */
export function isGoogleBlockedUrl(url: string, status?: number): boolean {
  return url.includes("google.com/sorry/") || status === 429;
}
