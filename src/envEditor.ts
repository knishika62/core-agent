import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import path from "node:path";
import { ENV_TEMPLATE } from "./envLoader.js";
import { globalConfigDir } from "./globalConfig.js";

export function envEditorPaths(cwd: string): { global: string; local: string } {
  return { global: path.join(globalConfigDir(), ".env"), local: path.join(cwd, ".env") };
}

/** Writes the default template to targetPath if nothing's there yet. Returns whether it created the file. */
export function ensureEnvFile(targetPath: string): boolean {
  if (existsSync(targetPath)) return false;
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, ENV_TEMPLATE, "utf-8");
  return true;
}

export function pickEditorCommand(): string {
  return process.env.EDITOR || process.env.VISUAL || (process.platform === "win32" ? "notepad" : "vi");
}

/** Blocks until the editor process exits. Returns false if it couldn't even launch (e.g. $EDITOR not found). */
export function openInEditor(targetPath: string): boolean {
  const result = spawnSync(pickEditorCommand(), [targetPath], { stdio: "inherit" });
  return !result.error;
}

/**
 * Full interactive flow behind `--env`: pick global vs project .env, create
 * it from the template if missing, then open it in $EDITOR. Shared by both
 * the TUI (`core-agent --env`) and GUI (`core-agent-gui --env`) entry
 * points, since a user who only ever runs one of the two binaries still
 * needs a way to get at .env — a GUI-only settings page was considered and
 * rejected for the same reason a TUI-only flag was: either one leaves the
 * other binary's users with no way in.
 */
export async function runEnvEditor(cwd: string): Promise<void> {
  const { global: globalPath, local: localPath } = envEditorPaths(cwd);
  let targetPath = globalPath;

  if (stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    console.log("Which .env do you want to edit?");
    console.log(`  1) Global  ${globalPath}${existsSync(globalPath) ? "" : " (will be created)"}`);
    console.log(`  2) Project ${localPath}${existsSync(localPath) ? "" : " (will be created)"}`);
    const answer = (await rl.question("Choose [1/2, default 1]: ")).trim();
    rl.close();
    if (answer === "2") targetPath = localPath;
  } else {
    console.log(`No TTY — defaulting to the global .env (${globalPath}).`);
  }

  if (ensureEnvFile(targetPath)) console.log(`Created ${targetPath} from the default template.`);

  const editor = pickEditorCommand();
  console.log(`Opening ${targetPath} with "${editor}"...`);
  if (!openInEditor(targetPath)) {
    console.log(`Could not launch "${editor}". Edit it manually: ${targetPath}`);
    console.log(`(Set $EDITOR to your preferred editor to use this command directly.)`);
  } else {
    console.log(`Done editing ${targetPath}.`);
  }
}
