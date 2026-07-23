import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolResult } from "../types.js";
import { requireConfirmation, type BashJob, type ToolContext } from "./context.js";

const DEFAULT_TIMEOUT_SEC = 3600;
const MAX_TIMEOUT_SEC = 24 * 3600;
const DEFAULT_REFRESH_SEC = 60;
const HEAD_LINES = 100;
const HEAD_BYTES = 8 * 1024;
const TAIL_RUNNING_LINES = 4;
const TAIL_DONE_LINES = 20;
const TAIL_BYTES = 32 * 1024;

function clampTimeout(v: unknown): number {
  const n = Number(v ?? DEFAULT_TIMEOUT_SEC);
  return Math.min(MAX_TIMEOUT_SEC, Math.max(1, Math.ceil(n)));
}

function clampRefresh(v: unknown): number {
  const n = Number(v ?? DEFAULT_REFRESH_SEC);
  return Math.min(3600, Math.max(1, n));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killGroup(job: BashJob, signal: NodeJS.Signals): void {
  try {
    process.kill(-job.pid, signal);
  } catch {
    // process may already be gone
  }
}

function spawnJob(command: string, timeoutSec: number, ctx: ToolContext): BashJob {
  const id = ctx.allocateBashJobId();
  const child = spawn("/bin/sh", ["-c", command], {
    cwd: ctx.cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const job: BashJob = {
    id,
    pid: child.pid!,
    command,
    child,
    outputPath: path.join(tmpdir(), `my-agent-bash-${id}-${Date.now()}`),
    output: "",
    startTime: Date.now(),
    timeoutSec,
    done: false,
    exitCode: null,
    timedOut: false,
    observedOnce: false,
  };

  child.stdout?.on("data", (chunk) => (job.output += chunk.toString("utf-8")));
  child.stderr?.on("data", (chunk) => (job.output += chunk.toString("utf-8")));

  const timer = setTimeout(() => {
    if (!job.done) {
      job.timedOut = true;
      killGroup(job, "SIGKILL");
    }
  }, timeoutSec * 1000);

  child.on("close", (code) => {
    job.done = true;
    job.exitCode = code;
    clearTimeout(timer);
  });

  ctx.bashJobs.set(id, job);
  return job;
}

function waitForJobSettled(job: BashJob, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (job.done) return resolve();
    const timer = setTimeout(resolve, ms);
    job.child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function findJob(args: Record<string, unknown>, ctx: ToolContext): BashJob | undefined {
  const jobId = Number(args.job ?? 0);
  if (jobId > 0) return ctx.bashJobs.get(jobId);
  const pid = Number(args.pid ?? 0);
  if (pid > 0) {
    for (const job of ctx.bashJobs.values()) if (job.pid === pid) return job;
  }
  return undefined;
}

function formatObservation(job: BashJob): string {
  const elapsed = (Date.now() - job.startTime) / 1000;
  const lines: string[] = [];

  if (!job.done) {
    lines.push(
      `bash job=${job.id} pid=${job.pid} status=running elapsed_sec=${elapsed.toFixed(1)} timeout_sec=${job.timeoutSec.toFixed(0)}`,
    );
  } else {
    lines.push(`bash job=${job.id} pid=${job.pid} status=done exit_status=${job.exitCode}`);
    if (job.timedOut) lines.push("timed_out=true");
  }

  const outputBytes = Buffer.byteLength(job.output, "utf-8");
  if (!job.observedOnce) {
    job.observedOnce = true;
    if (outputBytes <= HEAD_BYTES && job.output.split("\n").length <= HEAD_LINES) {
      lines.push(`<output>\n${job.output}\n</output>`);
    } else {
      writeFileSync(job.outputPath, job.output, "utf-8");
      const headLines = job.output.split("\n").slice(0, HEAD_LINES).join("\n").slice(0, HEAD_BYTES);
      lines.push(`<head -${HEAD_LINES} ${job.outputPath}>\n${headLines}\n</head>`);
      lines.push(`output_path=${job.outputPath}`);
    }
  } else {
    writeFileSync(job.outputPath, job.output, "utf-8");
    const n = job.done ? TAIL_DONE_LINES : TAIL_RUNNING_LINES;
    const allLines = job.output.split("\n");
    const tailLines = allLines.slice(-n).join("\n").slice(-TAIL_BYTES);
    lines.push(`<tail -${n} ${job.outputPath}>\n${tailLines}\n</tail>`);
  }

  if (!job.done) {
    lines.push(`Use bash_status job=${job.id} to get info before refresh time; use bash_stop job=${job.id} to stop execution`);
  }

  return lines.join("\n") + "\n";
}

export async function toolBash(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const command = args.command as string | undefined;
  if (!command) return { content: "Tool error: bash requires command\n", isError: true };

  const denied = await requireConfirmation(ctx, "bash", `Run: ${command}`);
  if (denied) return denied;

  const timeoutSec = clampTimeout(args.timeout_sec);
  const refreshSec = clampRefresh(args.refresh_sec);

  let job: BashJob;
  try {
    job = spawnJob(command, timeoutSec, ctx);
  } catch (err: any) {
    return { content: `Tool error: bash failed to start: ${err.message}\n`, isError: true };
  }

  await waitForJobSettled(job, refreshSec * 1000);
  const content = formatObservation(job);
  if (job.done) ctx.bashJobs.delete(job.id);
  return { content };
}

export async function toolBashStatus(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const job = findJob(args, ctx);
  if (!job) {
    return {
      content: `Tool error: bash job not found: job=${args.job ?? 0} pid=${args.pid ?? 0}\n`,
      isError: true,
    };
  }
  const content = formatObservation(job);
  if (job.done) ctx.bashJobs.delete(job.id);
  return { content };
}

export async function toolBashStop(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const job = findJob(args, ctx);
  if (!job) {
    return {
      content: `Tool error: bash job not found: job=${args.job ?? 0} pid=${args.pid ?? 0}\n`,
      isError: true,
    };
  }

  if (!job.done) {
    killGroup(job, "SIGTERM");
    await waitForJobSettled(job, 1000);
    if (!job.done) killGroup(job, "SIGKILL");
  }

  const refreshSec = clampRefresh(args.refresh_sec);
  await waitForJobSettled(job, refreshSec * 1000);
  const content = formatObservation(job);
  if (job.done) ctx.bashJobs.delete(job.id);
  return { content };
}
