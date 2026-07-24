import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { globalConfigDir } from "./globalConfig.js";

export interface CronJob {
  name: string;
  /** Standard 5-field cron expression (validated with node-cron). */
  schedule: string;
  /** Sent as the user message when the job fires. */
  prompt: string;
  /** Session file this job's history accumulates in. Defaults to `name`. */
  session?: string;
}

export interface CronFile {
  jobs: CronJob[];
}

/**
 * Prefers a project-local .core-agent/cron.json (cwd), falling back to
 * ~/.core-agent/cron.json. cron jobs are meant to run unattended from
 * wherever the binary happens to be started (a background daemon isn't
 * naturally tied to "the folder you cd'd into today" the way interactive
 * use is), so the global default matters even more here than for hooks.
 */
export async function loadCronConfig(cwd: string): Promise<CronFile> {
  const local = path.join(cwd, ".core-agent", "cron.json");
  const cronPath = existsSync(local) ? local : path.join(globalConfigDir(), "cron.json");
  try {
    const raw = await readFile(cronPath, "utf-8");
    const parsed = JSON.parse(raw);
    const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
    return { jobs: jobs.filter((j: unknown): j is CronJob => isValidJobShape(j)) };
  } catch {
    return { jobs: [] };
  }
}

function isValidJobShape(job: unknown): job is CronJob {
  if (!job || typeof job !== "object") return false;
  const j = job as Record<string, unknown>;
  return typeof j.name === "string" && typeof j.schedule === "string" && typeof j.prompt === "string";
}
