import { stat } from "node:fs/promises";
import path from "node:path";
import open from "open";
import type { ToolResult } from "../types.js";
import type { ToolContext } from "./context.js";
import { cleanDroppedPath } from "./pathUtils.js";

/**
 * Terminal sessions are text-only — there's no general way to put an image,
 * video, or audio clip "in" the conversation the way a chat UI could. The
 * cross-platform-safe option is to hand the file to the OS's own default
 * app (Preview/QuickTime on macOS, the registered handler on Windows,
 * xdg-open on Linux) via the `open` package, rather than a terminal-specific
 * inline image protocol (kitty/iTerm2 graphics) — those only work in one
 * or two terminal emulators and don't exist at all on Windows terminals,
 * which defeats the point given this tool needs to work everywhere.
 */
export async function toolShowMedia(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const rawPath = args.path as string | undefined;
  if (!rawPath) return { content: "Tool error: show_media requires path\n", isError: true };

  const filePath = path.resolve(ctx.cwd, cleanDroppedPath(rawPath));
  try {
    await stat(filePath);
  } catch (err: any) {
    return { content: `Tool error: could not open ${rawPath}: ${err.message}\n`, isError: true };
  }

  if (ctx.skipMediaOpen) {
    return { content: `Shown ${rawPath} to the user.\n` };
  }

  try {
    await open(filePath);
  } catch (err: any) {
    return { content: `Tool error: failed to open ${rawPath}: ${err.message}\n`, isError: true };
  }

  return { content: `Opened ${rawPath} in the default application for the user to view.\n` };
}
