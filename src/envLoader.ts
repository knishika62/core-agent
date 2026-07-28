import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readSync, writeFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { globalConfigDir } from "./globalConfig.js";

const PYTHON_PATH_PLACEHOLDER = "# PYTHON_PATH=/path/to/venv/bin/python";

// Mirrors .env.example — embedded rather than read from disk, since a
// distributed single-file binary has no guarantee that file sits anywhere
// near it (the whole point of the cwd -> ~/.core-agent fallback this
// supports is that the binary can be launched from anywhere).
export const ENV_TEMPLATE = `# Main text/coding model (speed is secondary to coding quality)
OPENAI_BASE_URL=http://127.0.0.1:8000/v1
OPENAI_API_KEY=
LLM_MODEL=deepseek-v4-flash
# Set to "anthropic" to speak /v1/messages instead of OpenAI's /v1/chat/completions.
LLM_PROTOCOL=openai

# Vision fallback model, used only via the view_image tool call.
VISION_BASE_URL=
VISION_API_KEY=
VISION_MODEL=

# Max tool-use rounds per turn before the agent is forced to stop and answer.
MAX_TOOL_ROUNDS=50

# Rough token-budget (chars/4 estimate) past which older history gets
# summarized so long sessions don't overflow the model's context window.
MAX_CONTEXT_TOKENS=60000

# If set, google_search hits this HTTP JSON endpoint instead of driving a
# real Chrome against google.com.
# SEARCH_ENGINE_URL=http://192.168.11.50:8888

# Browser (visit_page/google_search tools). All optional.
# CORE_AGENT_CHROME=/path/to/chrome              # explicit Chrome executable path
# CORE_AGENT_CHROME_PROFILE=/path/to/profile-dir # explicit profile dir (default ~/.core-agent/browser)
# CORE_AGENT_CHROME_HEADLESS=1                   # run headless instead of a visible window
# CORE_AGENT_CHROME_WINDOW_SIZE=480,360          # visible window size in pixels (default 480,360)
# CORE_AGENT_CHROME_WINDOW_POSITION=0,0          # visible window position in pixels (default top-left corner)

# Set to disable colorized/Markdown CLI output (also auto-disabled for non-TTY output).
# NO_COLOR=1

# Web GUI (src/webServer.ts, "npm run dev:gui"). Listens on all interfaces
# (LAN-reachable) by default — no authentication, so only run this on a
# trusted network. Both overridable.
# GUI_HOST=0.0.0.0
# GUI_PORT=8787
# show_media (image/video/audio) renders inline in the session by default,
# streamed from the server over HTTP — needed for it to work at all when
# the browser is on a different machine than the server (LAN access). Set
# to 0 to disable if you'd rather the server not stream file contents over
# HTTP.
# GUI_INLINE_MEDIA=1

# Absolute path to a Python interpreter (typically inside a venv you manage
# yourself). If set, the agent is told to use this instead of a bare
# python/python3, so it doesn't pip-install into your system Python.
${PYTHON_PATH_PLACEHOLDER}

# mail_send skill (skills/mail_send): sends email via SMTP.
EMAIL_TO=
EMAIL_FROM=
EMAIL_SMTP_SERVER=smtp.gmail.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USER=
EMAIL_SMTP_PASSWORD=
`;

function pythonCandidates(): string[] {
  // Windows installs from python.org register "python", not "python3";
  // POSIX systems (including Homebrew/apt Python) are the reverse — tried
  // in whichever order is more likely to hit on that platform, falling
  // through to the other one either way.
  return process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
}

function venvPythonPath(venvDir: string): string {
  return process.platform === "win32" ? path.join(venvDir, "Scripts", "python.exe") : path.join(venvDir, "bin", "python");
}

/** Just checks a candidate command actually runs — cheap, and lets the
 *  caller report "no Python found" up front instead of that only being
 *  inferrable from `-m venv` failing (which could fail for other reasons). */
function findPython(): string | null {
  for (const python of pythonCandidates()) {
    try {
      execSync(`${python} --version`, { stdio: "ignore" });
      return python;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Creates a dedicated venv under the global config dir so first-run setup
 * can pre-fill PYTHON_PATH instead of leaving "go create a venv yourself" as
 * a manual follow-up step. Assumes findPython() already confirmed a Python
 * exists (loadEnvFile checks that up front and won't call this otherwise) —
 * only the venv-creation step itself is best-effort here (returns null and
 * logs why on failure, e.g. a Python install missing the venv module).
 */
function trySetupVenv(globalDir: string, python: string): string | null {
  const venvDir = path.join(globalDir, "venv");
  try {
    execSync(`${python} -m venv ${JSON.stringify(venvDir)}`, { stdio: "ignore" });
    const interpreter = venvPythonPath(venvDir);
    if (existsSync(interpreter)) return interpreter;
    console.log(`"${python} -m venv" ran but no interpreter appeared at ${interpreter} — skipping automatic venv setup.`);
    return null;
  } catch (err: any) {
    console.log(`"${python} -m venv" failed — skipping automatic venv setup (${err.message ?? err}).`);
    return null;
  }
}

/** Blocks on a single byte from stdin (fd 0), synchronously. Used only for
 *  the first-run pause below, where a full async readline round-trip isn't
 *  worth pulling in — a piped/closed stdin (CI, scripts) throws here, which
 *  is treated as "nothing to wait on" rather than an error. */
function waitForKeypress(): void {
  try {
    const buf = Buffer.alloc(1);
    readSync(0, buf, 0, 1, null);
  } catch {
    // non-interactive stdin — nothing to pause on.
  }
}

/**
 * Loads .env, preferring a project-local file (cwd/.env — keeps existing
 * `npm run dev` / per-project override behavior unchanged) and falling back
 * to a global one (~/.core-agent/.env) so a distributed binary on PATH,
 * launched from any directory, still finds its config.
 *
 * First run (neither exists): writes a starter ~/.core-agent/.env from the
 * embedded template, prints setup instructions, and pauses for a keypress
 * before exiting — printing-then-immediately-exiting risks the message
 * flashing past unread in a console window that closes itself (a Windows
 * double-click pitfall, but not exclusive to it), so the pause applies on
 * every platform rather than special-casing one.
 */
export function loadEnvFile(cwd: string): void {
  const localEnv = path.join(cwd, ".env");
  if (existsSync(localEnv)) {
    dotenv.config({ path: localEnv });
    return;
  }

  const globalDir = globalConfigDir();
  const globalEnv = path.join(globalDir, ".env");
  if (existsSync(globalEnv)) {
    dotenv.config({ path: globalEnv });
    return;
  }

  // First run requires a system Python to be present *before* anything is
  // written: the generated .env should always come with PYTHON_PATH already
  // pointed at a working dedicated venv, not a commented-out placeholder the
  // user has to notice and fix later. If there's no Python at all, stop here
  // (no files written) rather than proceeding without it.
  const python = findPython();
  if (!python) {
    console.log(
      "No Python interpreter found on PATH.\n" +
        "core-agent's first-run setup creates a dedicated Python venv (for PYTHON_PATH) as part of the " +
        "initial .env — install Python (python3), make sure it's on PATH, then run core-agent again.\n\n" +
        "Press any key to exit...",
    );
    waitForKeypress();
    process.exit(0);
  }

  mkdirSync(globalDir, { recursive: true });
  const venvPython = trySetupVenv(globalDir, python);
  const envContent = venvPython ? ENV_TEMPLATE.replace(PYTHON_PATH_PLACEHOLDER, `PYTHON_PATH=${venvPython}`) : ENV_TEMPLATE;
  writeFileSync(globalEnv, envContent, "utf-8");
  console.log(
    `First run: created ${globalEnv}\n` +
      "Edit it with your LLM endpoint/API key, then run core-agent again.\n\n" +
      (venvPython
        ? `Also created a dedicated Python venv at ${path.join(globalDir, "venv")} and set PYTHON_PATH in ` +
          ".env to it, so Python scripts have a place to pip-install into without touching your system " +
          "Python — no extra setup needed there.\n\n"
        : "") +
      "To use the built-in mail-send/PDF-export skills, copy this build's skills/ folder to\n" +
      `${path.join(globalDir, "skills")} (requires Node.js to be installed).\n\n` +
      "Press any key to exit...",
  );
  waitForKeypress();
  process.exit(0);
}
