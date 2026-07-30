import { readFile, readdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import type { ToolDefinition, ToolResult } from "./types.js";
import { requireConfirmation, type ToolContext } from "./tools/context.js";
import { registerTool, type ToolFn } from "./tools/index.js";
import { globalConfigDir } from "./globalConfig.js";

interface SkillToolManifest {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  /** Shell command run from the skill's own directory; args are passed as
   *  a JSON object on stdin. No fixed interpreter is assumed, so skills can
   *  be written in Python, a shell script, another Node script, etc. — but
   *  the command string itself is whatever the skill author wrote, so a
   *  skill using "python3" won't run as-is on a Windows box that only has
   *  "python" on PATH. That's a per-skill portability concern, not
   *  something this loader can paper over. */
  command: string;
  /** Overrides DEFAULT_TIMEOUT_MS for this one tool. Needed for skills whose
   *  own internal poll loop (e.g. ltx_video_faceid waiting on a slow GPU job)
   *  legitimately runs longer than the 2-minute default — without this, the
   *  parent execSync() kills the skill process before its own timeout logic
   *  ever gets a chance to run, no matter how that script is written. */
  timeout_ms?: number;
}

interface SkillManifest {
  name: string;
  description?: string;
  tools: SkillToolManifest[];
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

function makeSkillHandler(skillName: string, skillDir: string, tool: SkillToolManifest): ToolFn {
  return async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const denied = await requireConfirmation(
      ctx,
      tool.name,
      `Run skill tool "${skillName}/${tool.name}": ${tool.command}`,
      JSON.stringify(args, null, 2),
    );
    if (denied) return denied;

    try {
      // No explicit `shell` path: execSync picks the OS-appropriate shell
      // automatically (POSIX /bin/sh, Windows cmd.exe), same reasoning as
      // hooks.ts.
      const stdout = execSync(tool.command, {
        cwd: skillDir,
        input: JSON.stringify(args),
        env: process.env,
        timeout: tool.timeout_ms ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
      }).toString("utf-8");
      return { content: stdout || `(skill "${skillName}/${tool.name}" produced no output)\n` };
    } catch (err: any) {
      const stderr = err.stderr?.toString("utf-8") || err.stdout?.toString("utf-8") || String(err.message ?? err);
      return { content: `Tool error: skill "${skillName}/${tool.name}" failed: ${stderr}\n`, isError: true };
    }
  };
}

// runTurn() re-scans skills every round (see agent.ts) so a skill authored
// mid-session is usable without a restart — which means scanSkillsDir() now
// re-discovers every already-loaded skill on every single round too. Without
// this, registerTool()'s "already exists" warning (meant for a genuine name
// collision) would instead fire continuously for completely expected
// re-registration attempts, spamming stderr once per round for the entire
// session. Tracked by "skillName/toolName" (not just tool name) so distinct
// skills that happen to collide on tool name are still only warned about once
// each, not silenced against each other.
const attemptedSkillTools = new Set<string>();
const loadedSkillTools = new Set<string>();

/**
 * Discovers skills under <skillsDir>/<skill-name>/skill.json and registers
 * each declared tool via registerTool(). Returns the "skillName/toolName"
 * labels that were successfully loaded.
 */
async function scanSkillsDir(skillsDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const loaded: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(skillsDir, entry.name);
    let manifest: SkillManifest;
    try {
      const raw = await readFile(path.join(skillDir, "skill.json"), "utf-8");
      manifest = JSON.parse(raw);
    } catch {
      continue; // no (valid) manifest — not a skill directory
    }

    for (const tool of manifest.tools ?? []) {
      const label = `${manifest.name}/${tool.name}`;
      if (attemptedSkillTools.has(label)) {
        if (loadedSkillTools.has(label)) loaded.push(label);
        continue;
      }
      attemptedSkillTools.add(label);

      const definition: ToolDefinition = {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters ?? { type: "object", properties: {} },
      };
      const ok = registerTool(definition, makeSkillHandler(manifest.name, skillDir, tool));
      if (ok) {
        loaded.push(label);
        loadedSkillTools.add(label);
      }
    }
  }
  return loaded;
}

/**
 * Scans both <cwd>/skills (project-local) and ~/.core-agent/skills (global —
 * where the distributed build's standard skills like mail_send/pdf_export
 * get copied) and registers everything found. cwd is scanned first, so on a
 * name collision the project-local skill wins and the global one is skipped
 * with a warning (registerTool()'s existing dedup) — this is deliberately
 * the *only* place that knows what a skill directory looks like, everything
 * downstream (agent.ts, cli.ts, executeToolCall) just sees ordinary tools,
 * same as the built-in ones.
 */
export async function loadSkills(cwd: string): Promise<string[]> {
  const local = await scanSkillsDir(path.join(cwd, "skills"));
  const global = await scanSkillsDir(path.join(globalConfigDir(), "skills"));
  return [...local, ...global];
}
