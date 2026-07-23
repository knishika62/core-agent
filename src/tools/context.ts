import type { ChildProcess } from "node:child_process";
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
  private nextBashJobId = 1;

  constructor(cwd: string = process.cwd(), confirm?: ConfirmFn) {
    this.cwd = cwd;
    this.confirm = confirm;
  }

  allocateBashJobId(): number {
    return this.nextBashJobId++;
  }
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
