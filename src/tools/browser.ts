import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";

/** Mirrors ds4_web.c's web_chrome_executable(): reuse the machine's installed
 *  Chrome instead of bundling/downloading a private Chromium. */
function findChromeExecutable(): string {
  const env = process.env.MY_AGENT_CHROME;
  if (env) return env;

  const candidates =
    process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : [
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
          "/opt/google/chrome/chrome",
        ];

  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(
    "Could not find a Chrome install. Set MY_AGENT_CHROME to the Chrome executable path.",
  );
}

/**
 * A brand-new, cookie-less Chrome profile is a strong bot signal to Google
 * and gets CAPTCHA'd almost immediately. That's a one-time bootstrap cost,
 * not a design flaw: ds4_agent's own ~/.ds4/browser profile only looks
 * "trusted" today because it accumulated real cookies/session state over
 * months of actual use — the same thing happens here once this project's
 * own persistent profile (~/.my-agent/browser) sees real use.
 *
 * Deliberately NOT seeded from ds4's profile: this project is meant to
 * stand on its own (that's the whole point of the rewrite), and depending
 * on another local project's browser state would only work on this one
 * machine, for this one user, for as long as ds4_agent keeps being run to
 * keep it warm. Point MY_AGENT_CHROME_PROFILE at any existing profile
 * (including ds4's) if you want to bootstrap manually — but that's an
 * explicit opt-in, not the default.
 */
function findProfileDir(): string {
  const env = process.env.MY_AGENT_CHROME_PROFILE;
  if (env) return env;
  return path.join(homedir(), ".my-agent", "browser");
}

/** Must be called before getBrowser() — puppeteer.launch() creates the
 *  profile directory as a side effect, so this only tells the truth if
 *  checked first. */
export function isFreshProfile(): boolean {
  return !existsSync(findProfileDir());
}

let browserPromise: Promise<Browser> | null = null;
let warned = false;

export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const profileDir = findProfileDir();
    if (!warned) {
      warned = true;
      console.error(`[my-agent] launching Chrome for a web tool (profile: ${profileDir})...`);
    }
    browserPromise = puppeteer.launch({
      executablePath: findChromeExecutable(),
      headless: process.env.MY_AGENT_CHROME_HEADLESS === "1",
      userDataDir: profileDir,
      args: ["--remote-allow-origins=*"],
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
