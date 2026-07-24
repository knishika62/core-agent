#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { runTurn } from "./agent.js";
import { ToolContext, toolDefinitions } from "./tools/index.js";
import type { ConfirmFn } from "./tools/context.js";
import type { Message } from "./types.js";
import { config, initConfig } from "./config.js";
import { loadEnvFile } from "./envLoader.js";
import { loadSession, saveSession, listSessions } from "./session.js";
import { loadProjectInstructions, buildSystemPrompt } from "./projectInstructions.js";
import { color } from "./cliColors.js";
import { MarkdownStreamRenderer } from "./cliMarkdown.js";
import { closeBrowser } from "./tools/browser.js";
import { loadSkills } from "./skills.js";
import { loadHooksConfig } from "./hooks.js";
import { runCronDaemon, scheduleCronJobs } from "./cronDaemon.js";
import { baseSystemPrompt } from "./systemPrompt.js";

const REPL_COMMANDS: Record<string, string> = {
  "/help, /?": "Show this help",
  "/list": "List saved sessions",
  "/auto": "Toggle auto-approve for write/edit/bash/skill tools (or answer 'a' at any y/N prompt)",
  "/reset": "Clear the current session's conversation history",
  "/exit": "Quit",
  "!<command>": "Run a shell command directly, bypassing the model (e.g. !ls, !cd ..)",
  Esc: "Interrupt the LLM's response mid-stream (partial text is kept; running tools are not stopped)",
};

function formatRelativeTime(date: Date): string {
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86400)}d ago`;
}

async function printSessionList(currentSessionName: string): Promise<void> {
  const sessions = await listSessions();
  if (sessions.length === 0) {
    console.log(color.dim("No saved sessions yet.\n"));
    return;
  }
  console.log(color.dim("Saved sessions:"));
  for (const s of sessions) {
    const marker = s.name === currentSessionName ? color.bold("*") : " ";
    console.log(
      `${marker} ${s.name.padEnd(20)} ${color.dim(`${s.messageCount} messages, updated ${formatRelativeTime(s.updatedAt)}`)}`,
    );
  }
  console.log();
}

/**
 * `!cd <dir>` needs special handling: running `cd` inside a spawned shell
 * only changes that child process's directory, not ours, so the change
 * would vanish the instant the command exits. Instead we resolve the path
 * ourselves and chdir this process (and ctx.cwd, which is what every tool
 * actually resolves paths against) directly.
 */
function tryHandleCd(shellCmd: string, ctx: ToolContext): boolean {
  const match = shellCmd.match(/^cd(?:\s+(.*))?$/);
  if (!match) return false;
  const target = match[1]?.trim();
  const resolved = path.resolve(ctx.cwd, target ? target : homedir());
  try {
    process.chdir(resolved);
    ctx.cwd = resolved;
    console.log(color.dim(ctx.cwd));
  } catch (err: any) {
    console.log(color.error(`cd: ${err.message}`));
  }
  return true;
}

function runShellCommand(shellCmd: string, ctx: ToolContext): void {
  if (tryHandleCd(shellCmd, ctx)) return;
  try {
    execSync(shellCmd, { cwd: ctx.cwd, stdio: "inherit" });
  } catch {
    // execSync already streamed stderr via stdio:"inherit"; a non-zero
    // exit isn't something we need to editorialize about further here.
  }
}

function parseSessionName(argv: string[]): string {
  const idx = argv.indexOf("--session");
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  return "default";
}

function printHelp(): void {
  console.log(color.dim("REPL commands:"));
  for (const [cmd, desc] of Object.entries(REPL_COMMANDS)) {
    console.log(`  ${cmd.padEnd(12)} ${color.dim(desc)}`);
  }
  console.log(color.dim("\nTools available to the agent:"));
  for (const t of toolDefinitions) {
    console.log(`  ${t.name.padEnd(14)} ${color.dim(t.description)}`);
  }
  console.log();
}

async function main() {
  // Must happen before anything reads config.xxx: loads cwd/.env if present,
  // else ~/.core-agent/.env, else bootstraps the latter from a template and
  // exits (first run) — see envLoader.ts.
  loadEnvFile(process.cwd());
  initConfig();

  const argv = process.argv.slice(2);

  if (argv.includes("--cron")) {
    await runCronDaemon(process.cwd());
    return; // node-cron's internal timers keep the process alive
  }

  const sessionName = parseSessionName(argv);
  // Mutable, not just an initial flag: `/auto` flips this mid-session, so a
  // task that turns out to need a dozen bash/write calls in a row (e.g.
  // iterating on a Python script) doesn't force answering y/N every time.
  let autoMode = argv.includes("--yes") || argv.includes("-y");

  const rl = createInterface({ input: stdin, output: stdout });

  // Piped/non-TTY stdin (scripts, tests, CI) can hit EOF well before we get
  // around to our first rl.question() call — by the time that call happens
  // the interface has already auto-closed and any buffered lines are lost.
  // rl.question() only works reliably against a live TTY; for everything
  // else, drain lines via the async iterator instead, which handles
  // already-buffered/already-ended input correctly.
  const interactive = Boolean(stdin.isTTY);
  const lineIterator = interactive ? null : rl[Symbol.asyncIterator]();

  async function nextLine(promptText: string): Promise<string | null> {
    if (interactive) {
      try {
        return await rl.question(promptText);
      } catch (err: any) {
        // readline/promises' question() rejects with this (not a real
        // process-level SIGINT) when Ctrl-C is pressed while it's pending
        // — treating it as EOF reuses the same clean-exit path (browser
        // cleanup via main()'s .finally()) instead of an uncaught
        // rejection printing a raw stack trace.
        if (err?.code === "ERR_USE_AFTER_CLOSE" || err?.code === "ABORT_ERR") return null;
        throw err;
      }
    }
    const { value, done } = await lineIterator!.next();
    return done ? null : value;
  }

  const confirm: ConfirmFn = async ({ tool, description, preview }) => {
    if (autoMode) return true;
    console.log(color.warn(`\n[confirm] ${tool}: ${description}`));
    if (preview) {
      console.log(color.dim(preview.length > 500 ? preview.slice(0, 500) + "..." : preview));
    }
    if (!interactive) {
      console.log(color.dim("(no TTY to ask for confirmation — denying; pass --yes or use /auto to skip this gate)"));
      return false;
    }
    const answer = ((await nextLine(color.warn("Approve? (y/N/a=always) "))) ?? "").trim().toLowerCase();
    if (answer === "a" || answer === "always" || answer === "/auto") {
      autoMode = true;
      console.log(color.dim("Auto mode ON — write/edit/bash/skill tools will not ask for confirmation."));
      return true;
    }
    return answer === "y";
  };

  // ESC-to-interrupt: only meaningful while a turn is actually in flight,
  // so this stays null the rest of the time and the keypress handler below
  // is a no-op — pressing ESC at the "> " prompt (or during a y/N
  // confirmation) does nothing special.
  let currentAbort: AbortController | null = null;
  if (interactive) {
    emitKeypressEvents(stdin, rl);
    stdin.on("keypress", (_str, key) => {
      if (key?.name === "escape" && currentAbort) {
        currentAbort.abort();
      }
    });
  }

  const cwd = process.cwd();
  const ctx = new ToolContext(cwd, confirm);

  const projectInstructions = await loadProjectInstructions(cwd);
  const systemPrompt = buildSystemPrompt(baseSystemPrompt(), projectInstructions);
  const loadedSkills = await loadSkills(cwd);
  const hooksConfig = await loadHooksConfig(cwd);
  const hookCount = (hooksConfig.preToolUse?.length ?? 0) + (hooksConfig.postToolUse?.length ?? 0);
  // Scheduled here too (not just in --cron mode): an interactive session is
  // typically left open for a while, so that's a reasonable place for cron
  // jobs to also run in the background rather than requiring a second,
  // dedicated `--cron` process just for scheduling.
  const cronScheduled = await scheduleCronJobs(cwd, systemPrompt);

  let messages: Message[];
  try {
    messages = await loadSession(sessionName);
    // Re-synced on every run: project instructions may have changed since
    // this session was last saved.
    messages[0] = { role: "system", content: systemPrompt };
    console.log(`core-agent — model: ${config.main.model} @ ${config.main.baseUrl}`);
    console.log(`Resumed session "${sessionName}" (${messages.length} messages).`);
  } catch {
    messages = [{ role: "system", content: systemPrompt }];
    console.log(`core-agent — model: ${config.main.model} @ ${config.main.baseUrl}`);
    console.log(`Starting new session "${sessionName}".`);
  }
  if (projectInstructions) console.log(color.dim("(loaded project instructions from AGENT.md)"));
  if (loadedSkills.length) console.log(color.dim(`(loaded skills: ${loadedSkills.join(", ")})`));
  if (hookCount > 0) console.log(color.dim(`(loaded ${hookCount} hook(s) from hooks.json)`));
  if (cronScheduled > 0) console.log(color.dim(`(scheduled ${cronScheduled} cron job(s) from cron.json)`));
  if (autoMode) console.log(color.dim("(auto mode ON: write/edit/bash/skill tools will not ask for confirmation — /auto to toggle)"));
  console.log(color.dim("Type your message, /help for commands, /exit to quit.\n"));

  while (true) {
    const line = await nextLine(color.user("> "));
    if (line === null) break; // EOF (piped input exhausted, or closed TTY)
    const trimmed = line.trim();
    if (trimmed === "/exit") break;
    if (trimmed === "/help" || trimmed === "/?") {
      printHelp();
      continue;
    }
    if (trimmed === "/list") {
      await printSessionList(sessionName);
      continue;
    }
    if (trimmed === "/auto") {
      autoMode = !autoMode;
      console.log(
        color.dim(
          autoMode
            ? "Auto mode ON — write/edit/bash/skill tools will not ask for confirmation."
            : "Auto mode OFF — confirmation prompts are back.",
        ),
      );
      continue;
    }
    if (trimmed === "/reset") {
      messages = [{ role: "system", content: systemPrompt }];
      console.log(color.dim(`Session "${sessionName}" reset.\n`));
      continue;
    }
    if (trimmed.startsWith("!")) {
      const shellCmd = trimmed.slice(1).trim();
      if (shellCmd) runShellCommand(shellCmd, ctx);
      continue;
    }
    if (!trimmed) continue;

    messages.push({ role: "user", content: line });

    const renderer = new MarkdownStreamRenderer();
    currentAbort = new AbortController();
    if (interactive) console.log(color.dim("(Esc to interrupt)"));
    await runTurn(messages, ctx, {
      onTextDelta: (text) => renderer.write(text),
      onToolCall: (name, args) => {
        renderer.flush();
        console.log(color.dim(`\n[tool call] ${name}(${args})`));
      },
      onToolResult: (name, content) => {
        const preview = content.length > 300 ? content.slice(0, 300) + "..." : content;
        renderer.flush();
        console.log(color.dim(`[tool result: ${name}]\n${preview}`));
      },
      onCompact: () => {
        renderer.flush();
        console.log(color.dim("\n[history compacted to stay within context budget]"));
      },
      onError: (err) => {
        renderer.flush();
        console.log(color.error(`\n[LLM request failed: ${err instanceof Error ? err.message : String(err)}]`));
      },
      abortSignal: currentAbort.signal,
    });
    if (currentAbort.signal.aborted) {
      renderer.flush();
      console.log(color.warn("\n[Interrupted]"));
    }
    currentAbort = null;
    renderer.flush();
    stdout.write("\n\n");

    await saveSession(sessionName, messages);
  }
  rl.close();
}

// Ctrl-C during a run hits the same leak: close the browser cleanly instead
// of leaving an orphaned Chrome process (and a stale profile lock) behind.
process.on("SIGINT", async () => {
  await closeBrowser();
  process.exit(0);
});

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeBrowser());
