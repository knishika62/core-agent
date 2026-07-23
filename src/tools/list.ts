import { readdir, stat, lstat } from "node:fs/promises";
import path from "node:path";
import type { ToolResult } from "../types.js";
import type { ToolContext } from "./context.js";

const MAX_ENTRIES = 300;

export async function toolList(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const rawPath = (args.path as string | undefined) ?? ".";
  const dirPath = path.resolve(ctx.cwd, rawPath);

  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch (err: any) {
    return { content: `Tool error: opendir failed: ${err.message}\n`, isError: true };
  }

  entries.sort();
  const shown = entries.slice(0, MAX_ENTRIES);
  const lines: string[] = [`${rawPath}:`];

  for (const name of shown) {
    const full = path.join(dirPath, name);
    let type = "?";
    let size = 0;
    try {
      const lst = await lstat(full);
      if (lst.isSymbolicLink()) {
        type = "l";
        size = lst.size;
      } else if (lst.isDirectory()) {
        type = "d";
        size = lst.size;
      } else if (lst.isFile()) {
        type = "-";
        size = lst.size;
      }
    } catch {
      type = "?";
    }
    const suffix = type === "d" ? "/" : "";
    lines.push(`${type} ${String(size).padStart(10)} ${name}${suffix}`);
  }

  if (entries.length > MAX_ENTRIES) {
    lines.push(`... ${entries.length - MAX_ENTRIES} more entries omitted ...`);
  }

  return { content: lines.join("\n") + "\n" };
}
