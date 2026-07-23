import { readFile } from "node:fs/promises";
import path from "node:path";

const CANDIDATE_FILENAMES = ["AGENT.md", "AGENTS.md", ".agent.md"];

/** Auto-loads a project-level instructions file (CLAUDE.md-equivalent) from
 *  cwd, if one exists, to fold into the system prompt. First match wins. */
export async function loadProjectInstructions(cwd: string): Promise<string | null> {
  for (const name of CANDIDATE_FILENAMES) {
    try {
      const text = await readFile(path.join(cwd, name), "utf-8");
      if (text.trim()) return text;
    } catch {
      // not found or unreadable — try the next candidate
    }
  }
  return null;
}

export function buildSystemPrompt(base: string, projectInstructions: string | null): string {
  if (!projectInstructions) return base;
  return `${base}\n\n# Project instructions\n\n${projectInstructions}`;
}
