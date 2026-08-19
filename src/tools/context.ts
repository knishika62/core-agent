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
 *  confirming unconditionally, so this is deliberately not wired in there. */
export function isPathAutoApproved(cwd: string, absoluteTargetPath: string): boolean {
  const targetDir = safeRealpath(path.dirname(absoluteTargetPath));
  const targetReal = path.join(targetDir, path.basename(absoluteTargetPath));
  const cwdReal = safeRealpath(cwd);
  const tmpReal = safeRealpath(tmpdir());
  return isWithin(cwdReal, targetReal) || isWithin(tmpReal, targetReal);
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
