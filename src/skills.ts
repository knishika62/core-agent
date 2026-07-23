import { readFile, readdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import type { ToolDefinition, ToolResult } from "./types.js";
import { requireConfirmation, type ToolContext } from "./tools/context.js";
import { registerTool, type ToolFn } from "./tools/index.js";

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
        timeout: DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
      }).toString("utf-8");
      return { content: stdout || `(skill "${skillName}/${tool.name}" produced no output)\n` };
    } catch (err: any) {
      const stderr = err.stderr?.toString("utf-8") || err.stdout?.toString("utf-8") || String(err.message ?? err);
      return { content: `Tool error: skill "${skillName}/${tool.name}" failed: ${stderr}\n`, isError: true };
    }
  };
}

/**
 * Discovers skills under <cwd>/skills/<skill-name>/skill.json and registers
 * each declared tool via registerTool(). Returns the "skillName/toolName"
 * labels that were successfully loaded, for a startup log line.
 *
 * This is deliberately the *only* place that knows what a skill directory
 * looks like — everything downstream (agent.ts, cli.ts, executeToolCall)
 * just sees ordinary tools, same as the built-in ones.
 */
export async function loadSkills(cwd: string): Promise<string[]> {
  const skillsDir = path.join(cwd, "skills");
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
      const definition: ToolDefinition = {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters ?? { type: "object", properties: {} },
      };
      const ok = registerTool(definition, makeSkillHandler(manifest.name, skillDir, tool));
      if (ok) loaded.push(`${manifest.name}/${tool.name}`);
    }
  }
  return loaded;
}
