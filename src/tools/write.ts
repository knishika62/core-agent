import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolResult } from "../types.js";
import { requireConfirmation, type ToolContext } from "./context.js";

export async function toolWrite(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const rawPath = args.path as string | undefined;
  const content = args.content as string | undefined;
  if (!rawPath) return { content: "Tool error: write requires path\n", isError: true };
  if (content === undefined) return { content: "Tool error: write requires content\n", isError: true };

  const denied = await requireConfirmation(
    ctx,
    "write",
    `Write ${Buffer.byteLength(content, "utf-8")} bytes to ${rawPath} (overwrites if it exists)`,
    content.length > 2000 ? content.slice(0, 2000) + "..." : content,
  );
  if (denied) return denied;

  const filePath = path.resolve(ctx.cwd, rawPath);
  try {
    await writeFile(filePath, content, "utf-8");
  } catch (err: any) {
    return { content: `Tool error: open for write failed: ${err.message}\n`, isError: true };
  }
  return { content: `Wrote ${Buffer.byteLength(content, "utf-8")} bytes to ${rawPath}\n` };
}
