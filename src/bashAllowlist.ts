import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { globalConfigDir } from "./globalConfig.js";

/**
 * Not cached, same rationale as loadHooksConfig: tiny file, re-read every
 * call so edits take effect without a restart.
 *
 * Prefers a project-local .core-agent/bash-allowlist.json (cwd) over
 * ~/.core-agent/bash-allowlist.json, same fallback as hooks.json/cron.json.
 *
 * Absent by default (returns []), same as hooks.json's "no file = no
 * hooks" — which commands count as read-only enough to skip the confirm
 * gate is a policy call for the user to make via config, not something
 * core ships an opinion on. See isReadOnlyBashCommand (src/tools/context.ts)
 * for how this list is used.
 */
export async function loadBashAllowlist(cwd: string): Promise<string[]> {
  const local = path.join(cwd, ".core-agent", "bash-allowlist.json");
  const configPath = existsSync(local) ? local : path.join(globalConfigDir(), "bash-allowlist.json");
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((c) => typeof c === "string") : [];
  } catch {
    return [];
  }
}
