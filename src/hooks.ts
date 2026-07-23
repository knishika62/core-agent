import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";

export interface HookRule {
  /** Regex tested against the tool name; "*" or omitted matches everything. */
  match?: string;
  command: string;
}

export interface HooksConfig {
  preToolUse?: HookRule[];
  postToolUse?: HookRule[];
}

/**
 * Not cached: hooks.json is tiny and re-reading it lets a user edit hooks
 * while the agent is running (e.g. during a long cron daemon session)
 * without needing a restart.
 */
export async function loadHooksConfig(cwd: string): Promise<HooksConfig> {
  try {
    const raw = await readFile(path.join(cwd, ".core-agent", "hooks.json"), "utf-8");
    return JSON.parse(raw) as HooksConfig;
  } catch {
    return {};
  }
}

function matches(rule: HookRule, toolName: string): boolean {
  if (!rule.match || rule.match === "*") return true;
  try {
    return new RegExp(rule.match).test(toolName);
  } catch {
    return rule.match === toolName;
  }
}

interface HookRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * No explicit `shell` path here on purpose: execSync without one already
 * picks the OS-appropriate shell (/bin/sh on POSIX, cmd.exe on Windows),
 * so hook commands work cross-platform without any special-casing.
 */
function runHookCommand(command: string, cwd: string, extraEnv: Record<string, string>): HookRunResult {
  try {
    const stdout = execSync(command, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    }).toString("utf-8");
    return { exitCode: 0, stdout, stderr: "" };
  } catch (err: any) {
    return {
      exitCode: typeof err.status === "number" ? err.status : 1,
      stdout: err.stdout?.toString("utf-8") ?? "",
      stderr: err.stderr?.toString("utf-8") ?? String(err.message ?? err),
    };
  }
}

export interface PreHookResult {
  blocked: boolean;
  reason?: string;
}

/** A pre-hook that exits non-zero blocks the tool call, mirroring how
 *  Claude Code's own PreToolUse hooks work. */
export async function runPreToolUseHooks(cwd: string, toolName: string, argsJson: string): Promise<PreHookResult> {
  const config = await loadHooksConfig(cwd);
  for (const rule of config.preToolUse ?? []) {
    if (!matches(rule, toolName)) continue;
    const result = runHookCommand(rule.command, cwd, {
      CORE_AGENT_TOOL_NAME: toolName,
      CORE_AGENT_TOOL_ARGS: argsJson,
    });
    if (result.exitCode !== 0) {
      return { blocked: true, reason: (result.stderr || result.stdout || `pre-hook exited ${result.exitCode}`).trim() };
    }
  }
  return { blocked: false };
}

/** Post-hooks are side-effecting only (logging, notifications) — a failure
 *  here is reported but never overturns an already-produced tool result. */
export async function runPostToolUseHooks(
  cwd: string,
  toolName: string,
  argsJson: string,
  resultContent: string,
  isError: boolean,
): Promise<void> {
  const config = await loadHooksConfig(cwd);
  for (const rule of config.postToolUse ?? []) {
    if (!matches(rule, toolName)) continue;
    const result = runHookCommand(rule.command, cwd, {
      CORE_AGENT_TOOL_NAME: toolName,
      CORE_AGENT_TOOL_ARGS: argsJson,
      CORE_AGENT_TOOL_RESULT: resultContent.slice(0, 4000),
      CORE_AGENT_TOOL_ERROR: isError ? "1" : "0",
    });
    if (result.exitCode !== 0) {
      console.error(`[core-agent] post-tool-use hook for "${toolName}" failed: ${result.stderr || result.stdout}`);
    }
  }
}
