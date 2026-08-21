import type { ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolResult } from "../types.js";

export interface MoreState {
  path: string;
  nextLine: number;
  raw: boolean;
}

export interface BashJob {
  id: number;
  pid: number;
  command: string;
  child: ChildProcess;
  outputPath: string;
  output: string;
  startTime: number;
  timeoutSec: number;
  done: boolean;
  exitCode: number | null;
  timedOut: boolean;
  observedOnce: boolean;
}

export interface ConfirmRequest {
  tool: string;
  description: string;
  preview?: string;
}

export type ConfirmFn = (request: ConfirmRequest) => Promise<boolean>;

export class ToolContext {
  cwd: string;
  moreState: MoreState | null = null;
  bashJobs = new Map<number, BashJob>();
  /** Gate for destructive tools (write/edit/bash). Undefined = ungated
   *  (used by tests and programmatic callers); cli.ts wires this to a
   *  y/N prompt. */
  confirm?: ConfirmFn;
  /** When true, show_media skips opening a native app locally. The TUI
   *  needs that local open() — it's the only way a terminal can show media
   *  at all — but the GUI renders media inline in the browser instead, so
   *  the server machine also popping open a native app (of no use to a
   *  remote LAN viewer, and just redundant even for a local one) is exactly
   *  the noise this suppresses. Undefined/false = TUI's default. */
  skipMediaOpen?: boolean;
  private nextBashJobId = 1;

  constructor(cwd: string = process.cwd(), confirm?: ConfirmFn) {
    this.cwd = cwd;
    this.confirm = confirm;
  }

  allocateBashJobId(): number {
    return this.nextBashJobId++;
  }
}

// Resolves symlinks for containment comparisons only (never for actual I/O
// paths). Falls back to the input unchanged if it doesn't exist yet (e.g. a
// new file's parent dir) — fails closed, i.e. still requires confirmation.
function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** True if absoluteTargetPath resolves to somewhere inside cwd or the OS
 *  temp dir. Used by write/edit only — bash/skill tools take arbitrary
 *  command strings with no single extractable path and must keep
 *  confirming unconditionally, so this is deliberately not wired in there.
 *  (bash has its own, differently-scoped auto-approve — see
 *  isReadOnlyBashCommand below — for the narrower case of a single
 *  known-safe read-only program with no path-scoping at all.) */
export function isPathAutoApproved(cwd: string, absoluteTargetPath: string): boolean {
  const targetDir = safeRealpath(path.dirname(absoluteTargetPath));
  const targetReal = path.join(targetDir, path.basename(absoluteTargetPath));
  const cwdReal = safeRealpath(cwd);
  const tmpReal = safeRealpath(tmpdir());
  return isWithin(cwdReal, targetReal) || isWithin(tmpReal, targetReal);
}

// Chaining/redirection/substitution characters — if any appear, the command
// isn't "just run this one program", so it falls through to the normal
// confirm gate. Deliberately simple (no per-flag inspection like find's
// -exec/-delete) so the only way this can be wrong is by under-approving,
// never over-approving.
const SHELL_METACHAR_RE = /[;&|<>`$\n]/;

/** True if `command` is a single invocation of a program named in
 *  `allowlist`, with no shell chaining, redirection, or substitution.
 *  Which commands count as "safe" is deliberately not core's call — see
 *  loadBashAllowlist (src/bashAllowlist.ts) for where that list actually
 *  comes from (a user-edited config file, same pattern as hooks.json/
 *  cron.json: absent by default, opt-in). Used by bash only — unlike
 *  isPathAutoApproved this is deliberately NOT scoped to cwd/tmp, because
 *  the read/search/list tools it parallels already read any path on the
 *  filesystem with zero confirmation gate; matching that trust level for
 *  allowlisted bash commands adds no new risk. */
export function isReadOnlyBashCommand(command: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false;
  if (SHELL_METACHAR_RE.test(command)) return false;
  const first = command.trim().split(/\s+/)[0];
  if (!first) return false;
  return allowlist.includes(path.basename(first));
}

/** Returns a rejection ToolResult if the user declines, or null to proceed.
 *  A no-op (returns null immediately) when ctx.confirm isn't wired up. */
export async function requireConfirmation(
  ctx: ToolContext,
  tool: string,
  description: string,
  preview?: string,
): Promise<ToolResult | null> {
  if (!ctx.confirm) return null;
  const approved = await ctx.confirm({ tool, description, preview });
  if (approved) return null;
  return { content: `Tool error: ${tool} was not approved by the user.\n`, isError: true };
}
