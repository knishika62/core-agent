import { readFile } from "node:fs/promises";
import path from "node:path";

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

export async function loadCronConfig(cwd: string): Promise<CronFile> {
  try {
    const raw = await readFile(path.join(cwd, ".core-agent", "cron.json"), "utf-8");
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
