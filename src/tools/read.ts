import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ToolResult } from "../types.js";
import type { ToolContext } from "./context.js";
import { isBinary } from "./pathUtils.js";

const MAX_FILE_BYTES = 16 * 1024 * 1024; // 16MB, matches ds4_agent.c AGENT_FILE_MAX_BYTES
const DEFAULT_MAX_LINES = 250;

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

async function loadFile(filePath: string): Promise<string[]> {
  const st = await stat(filePath);
  if (st.size > MAX_FILE_BYTES) {
    throw new Error(`file too large: ${filePath} exceeds ${MAX_FILE_BYTES} bytes`);
  }
  const buf = await readFile(filePath);
  // Without this, a model asked to look at an image would sometimes reach
  // for `read` instead of `view_image` — nothing here rejected it (a
  // several-MB PNG is well under MAX_FILE_BYTES), so the raw bytes got
  // decoded as "utf-8 text" and handed back as a multi-million-character
  // tool result, blowing the model's real context window in a single turn.
  if (isBinary(buf)) {
    throw new Error(`binary file, not text — use view_image for images, or show_media to open it directly: ${filePath}`);
  }
  const text = buf.toString("utf-8");
  const lines = splitLines(text);
  // drop a single trailing empty line caused by a final newline
  if (lines.length > 0 && lines[lines.length - 1] === "" && text.endsWith("\n")) {
    lines.pop();
  }
  return lines;
}

function renderSlice(
  filePath: string,
  lines: string[],
  startLine: number,
  endLine: number,
  raw: boolean,
): string {
  const slice = lines.slice(startLine - 1, endLine);
  if (raw) {
    let out = slice.join("\n");
    if (!out.endsWith("\n")) out += "\n";
    return out;
  }
  const header = `${filePath}: lines ${startLine}-${endLine} of ${lines.length}\n`;
  const body = slice.map((l, i) => `${startLine + i} ${l}`).join("\n") + "\n";
  return header + body;
}

export async function toolRead(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const rawPath = args.path as string | undefined;
  if (!rawPath) return { content: "Tool error: read requires path\n", isError: true };
  const filePath = path.resolve(ctx.cwd, rawPath);

  const startLine = Math.max(1, Number(args.start_line ?? 1));
  const whole = Boolean(args.whole);
  const raw = Boolean(args.raw);
  const maxLines = Math.max(1, Number(args.max_lines ?? DEFAULT_MAX_LINES));

  let lines: string[];
  try {
    lines = await loadFile(filePath);
  } catch (err: any) {
    return { content: `Tool error: open ${rawPath}: ${err.message}\n`, isError: true };
  }

  const endLine = whole ? lines.length : Math.min(lines.length, startLine + maxLines - 1);
  let body = renderSlice(filePath, lines, startLine, endLine, raw);

  if (!whole && endLine < lines.length) {
    ctx.moreState = { path: filePath, nextLine: endLine + 1, raw };
    const note = `[Read truncated at line ${endLine} of ${lines.length}. continue_offset=${endLine + 1}. Call more with count=N to continue.]\n`;
    body += note;
  } else {
    ctx.moreState = null;
  }

  return { content: body };
}

export async function toolMore(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.moreState) {
    return { content: "Tool error: no previous output to continue\n", isError: true };
  }
  const { path: filePath, nextLine, raw } = ctx.moreState;
  const count = Math.max(1, Number(args.count ?? DEFAULT_MAX_LINES));

  let lines: string[];
  try {
    lines = await loadFile(filePath);
  } catch (err: any) {
    return { content: `Tool error: open ${filePath}: ${err.message}\n`, isError: true };
  }

  const endLine = Math.min(lines.length, nextLine + count - 1);
  let body = renderSlice(filePath, lines, nextLine, endLine, raw);

  if (endLine < lines.length) {
    ctx.moreState = { path: filePath, nextLine: endLine + 1, raw };
    body += `[Read truncated at line ${endLine} of ${lines.length}. continue_offset=${endLine + 1}. Call more with count=N to continue.]\n`;
  } else {
    ctx.moreState = null;
  }

  return { content: body };
}
