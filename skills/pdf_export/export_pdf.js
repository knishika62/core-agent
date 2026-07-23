import { existsSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { marked } from "marked";

// Mirrors core-agent's own src/tools/browser.ts chromeCandidates()/
// findChromeExecutable() — kept as a standalone copy rather than imported,
// since skills run as independent subprocesses and can't reach into core's
// src/. CORE_AGENT_CHROME (already documented for the main app) is honored
// here too, so one env var covers both.
function chromeCandidates() {
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

function findChromeExecutable() {
  const env = process.env.CORE_AGENT_CHROME;
  if (env) return env;
  for (const c of chromeCandidates()) if (existsSync(c)) return c;
  throw new Error("Could not find a Chrome install. Set CORE_AGENT_CHROME to the Chrome executable path.");
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

// System font stack rather than a bundled/embedded font: Chrome renders
// whatever's actually installed, which already covers Japanese (Hiragino/
// Yu Gothic on macOS, Meiryo/Yu Gothic UI on Windows, Noto Sans CJK on most
// Linux desktops) without the manual .ttc extraction + font registration
// dance that Python PDF libraries (reportlab, fpdf2) require for CJK text.
const HTML_TEMPLATE = (title, bodyHtml) => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    font-family: -apple-system, "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo",
      "Noto Sans CJK JP", "Segoe UI", sans-serif;
    font-size: 11pt;
    line-height: 1.7;
    color: #1a1a1a;
    padding: 0 4mm;
  }
  h1, h2, h3, h4 { line-height: 1.4; margin-top: 1.4em; margin-bottom: 0.5em; }
  h1 { font-size: 20pt; border-bottom: 2px solid #333; padding-bottom: 0.2em; }
  h2 { font-size: 16pt; border-bottom: 1px solid #ccc; padding-bottom: 0.15em; }
  h3 { font-size: 13pt; }
  code { font-family: "SF Mono", Menlo, Consolas, monospace; background: #f2f2f2; padding: 0.1em 0.3em; border-radius: 3px; }
  pre { background: #f2f2f2; padding: 0.8em; border-radius: 5px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #ccc; padding: 0.4em 0.7em; text-align: left; }
  th { background: #f2f2f2; }
  blockquote { border-left: 3px solid #ccc; margin: 1em 0; padding: 0.2em 1em; color: #555; }
  a { color: #0645ad; }
</style>
</head>
<body>
${title ? `<h1>${title}</h1>` : ""}
${bodyHtml}
</body>
</html>`;

async function main() {
  const raw = await readStdin();
  const args = JSON.parse(raw || "{}");
  const { markdown, output_path: outputPath, title } = args;

  if (!markdown) throw new Error("export_pdf requires markdown");
  if (!outputPath) throw new Error("export_pdf requires output_path");
  if (!path.isAbsolute(outputPath)) throw new Error("output_path must be an absolute path");

  const bodyHtml = marked.parse(markdown);
  const html = HTML_TEMPLATE(title, bodyHtml);

  const browser = await puppeteer.launch({
    executablePath: findChromeExecutable(),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "18mm", right: "18mm" },
    });
  } finally {
    await browser.close();
  }

  console.log(`Wrote PDF to ${outputPath}`);
}

main().catch((err) => {
  console.error(err.message ?? String(err));
  process.exit(1);
});
