import cron from "node-cron";
import { runTurn } from "./agent.js";
import { ToolContext } from "./tools/index.js";
import { loadSession, saveSession } from "./session.js";
import { loadProjectInstructions, buildSystemPrompt } from "./projectInstructions.js";
import { loadSkills } from "./skills.js";
import { loadCronConfig, type CronJob } from "./cronConfig.js";
import { baseSystemPrompt } from "./systemPrompt.js";
import type { Message } from "./types.js";

/**
 * Runs one cron job's turn to completion: load/create its dedicated
 * session, push the configured prompt as a user message, run the turn
 * unattended (no confirm gate — nobody's there to answer y/N), save.
 */
async function runCronJob(cwd: string, systemPrompt: string, job: CronJob): Promise<void> {
  const sessionName = job.session ?? job.name;
  // No confirm callback: an unattended job can't wait on a human, so
  // write/edit/bash (and skill tools) run without the gate. This is a
  // real, deliberate tradeoff for jobs that need to act unattended —
  // keep cron jobs scoped to what you're comfortable running with --yes.
  const ctx = new ToolContext(cwd);

  let messages: Message[];
  try {
    messages = await loadSession(sessionName);
    messages[0] = { role: "system", content: systemPrompt };
  } catch {
    messages = [{ role: "system", content: systemPrompt }];
  }
  messages.push({ role: "user", content: job.prompt });

  const tag = `[cron:${job.name}]`;
  await runTurn(messages, ctx, {
    onTextDelta: (text) => process.stdout.write(text),
    onToolCall: (name, args) => console.log(`${tag} tool call ${name}(${args})`),
    onToolResult: (name, content) => {
      const preview = content.length > 300 ? content.slice(0, 300) + "..." : content;
      console.log(`${tag} tool result ${name}: ${preview}`);
    },
    onCompact: () => console.log(`${tag} history compacted`),
    onError: (err) => console.error(`${tag} LLM request failed:`, err instanceof Error ? err.message : err),
  });

  await saveSession(sessionName, messages);
}

/**
 * Reads cron.json (see loadCronConfig for the cwd -> global fallback) and
 * schedules each valid job with node-cron.
 * Shared by both the dedicated `--cron` daemon and the normal interactive
 * REPL — a session left open is the common case, so cron jobs fire in the
 * background there too rather than requiring a separate always-on process
 * just for scheduling. A missing/empty config is a silent no-op either way
 * (node-cron's timers only exist for jobs that actually got registered).
 */
export async function scheduleCronJobs(cwd: string, systemPrompt: string): Promise<number> {
  const config = await loadCronConfig(cwd);
  let scheduled = 0;
  for (const job of config.jobs) {
    if (!cron.validate(job.schedule)) {
      console.error(`Skipping cron job "${job.name}": invalid schedule "${job.schedule}"`);
      continue;
    }
    cron.schedule(job.schedule, () => {
      console.log(`[cron:${job.name}] firing at ${new Date().toISOString()}`);
      runCronJob(cwd, systemPrompt, job).catch((err) => {
        console.error(`[cron:${job.name}] job failed:`, err);
      });
    });
    console.log(`  - cron "${job.name}": ${job.schedule}  (session: ${job.session ?? job.name})`);
    scheduled++;
  }
  return scheduled;
}

/**
 * Headless mode (`--cron`, no REPL): same scheduling as above, but this is
 * the process's whole purpose, so it's worth a dedicated startup banner and
 * an early exit if there's nothing configured to run. node-cron's own
 * internal timers keep the Node event loop (and thus the process) alive —
 * no explicit keep-alive hack needed. Browser cleanup on shutdown is
 * handled by the same SIGINT/finally wiring cli.ts already has for
 * interactive mode, since this just runs inside the same process.
 */
export async function runCronDaemon(cwd: string): Promise<void> {
  const projectInstructions = await loadProjectInstructions(cwd);
  const systemPrompt = buildSystemPrompt(baseSystemPrompt(), projectInstructions);
  const loadedSkills = await loadSkills(cwd);

  console.log(`core-agent cron daemon — skills: ${loadedSkills.join(", ") || "none"}`);

  const scheduled = await scheduleCronJobs(cwd, systemPrompt);
  if (scheduled === 0) {
    console.log(
      "No cron jobs configured (expected a cron.json with a \"jobs\" array, in .core-agent/ locally or in the global config dir). Exiting.",
    );
  } else {
    console.log(`${scheduled} job(s) scheduled. Running until interrupted (Ctrl-C).`);
  }
}
