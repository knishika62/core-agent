#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { runTurn } from "./agent.js";
import { ToolContext, toolDefinitions } from "./tools/index.js";
import type { ConfirmFn } from "./tools/context.js";
import type { Message } from "./types.js";
import { config } from "./config.js";
import { loadSession, saveSession, listSessions } from "./session.js";
import { loadProjectInstructions, buildSystemPrompt } from "./projectInstructions.js";
import { color } from "./cliColors.js";
import { MarkdownStreamRenderer } from "./cliMarkdown.js";
import { closeBrowser } from "./tools/browser.js";

const BASE_SYSTEM_PROMPT = `You are a coding agent. Use the available tools (read, more, write, list, edit, search, bash, bash_status, bash_stop, view_image, visit_page, google_search) to accomplish the user's request. You cannot see images directly; call view_image if you need to look at one.`;

const REPL_COMMANDS: Record<string, string> = {
  "/help": "Show this help",
  "/list": "List saved sessions",
  "/reset": "Clear the current session's conversation history",
  "/exit": "Quit",
  "!<command>": "Run a shell command directly, bypassing the model (e.g. !ls, !cd ..)",
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
  const argv = process.argv.slice(2);
  const sessionName = parseSessionName(argv);
  const skipConfirm = argv.includes("--yes") || argv.includes("-y");

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
        if (err?.code === "ERR_USE_AFTER_CLOSE") return null;
        throw err;
      }
    }
    const { value, done } = await lineIterator!.next();
    return done ? null : value;
  }

  const confirm: ConfirmFn | undefined = skipConfirm
    ? undefined
    : async ({ tool, description, preview }) => {
        console.log(color.warn(`\n[confirm] ${tool}: ${description}`));
        if (preview) {
          console.log(color.dim(preview.length > 500 ? preview.slice(0, 500) + "..." : preview));
        }
        if (!interactive) {
          console.log(color.dim("(no TTY to ask for confirmation — denying; pass --yes to skip this gate)"));
          return false;
        }
        const answer = await nextLine(color.warn("Approve? (y/N) "));
        return (answer ?? "").trim().toLowerCase() === "y";
      };

  const cwd = process.cwd();
  const ctx = new ToolContext(cwd, confirm);

  const projectInstructions = await loadProjectInstructions(cwd);
  const systemPrompt = buildSystemPrompt(BASE_SYSTEM_PROMPT, projectInstructions);

  let messages: Message[];
  try {
    messages = await loadSession(sessionName);
    // Re-synced on every run: project instructions may have changed since
    // this session was last saved.
    messages[0] = { role: "system", content: systemPrompt };
    console.log(`my-agent — model: ${config.main.model} @ ${config.main.baseUrl}`);
    console.log(`Resumed session "${sessionName}" (${messages.length} messages).`);
  } catch {
    messages = [{ role: "system", content: systemPrompt }];
    console.log(`my-agent — model: ${config.main.model} @ ${config.main.baseUrl}`);
    console.log(`Starting new session "${sessionName}".`);
  }
  if (projectInstructions) console.log(color.dim("(loaded project instructions from AGENT.md)"));
  if (skipConfirm) console.log(color.dim("(running with --yes: write/edit/bash will not ask for confirmation)"));
  console.log(color.dim("Type your message, /help for commands, /exit to quit.\n"));

  while (true) {
    const line = await nextLine(color.user("> "));
    if (line === null) break; // EOF (piped input exhausted, or closed TTY)
    const trimmed = line.trim();
    if (trimmed === "/exit") break;
    if (trimmed === "/help") {
      printHelp();
      continue;
    }
    if (trimmed === "/list") {
      await printSessionList(sessionName);
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
    });
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
