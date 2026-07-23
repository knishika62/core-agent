import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolResult } from "../types.js";
import { requireConfirmation, type ToolContext } from "./context.js";

const UPTO_MARKER = "[upto]";
const CONTEXT_BEFORE = 5;
const CONTEXT_AFTER = 8;
const LARGE_EDIT_THRESHOLD = 26;
const LARGE_EDIT_HEAD_TAIL = 18;

function findOccurrences(haystack: string, needle: string, from = 0): number[] {
  const indices: number[] = [];
  let idx = haystack.indexOf(needle, from);
  while (idx !== -1) {
    indices.push(idx);
    idx = haystack.indexOf(needle, idx + Math.max(needle.length, 1));
  }
  return indices;
}

/** Resolve `old` (possibly containing one [upto] marker) to a [start, end) span in `text`. */
function resolveSpan(text: string, old: string): { start: number; end: number } | { error: string } {
  const uptoCount = old.split(UPTO_MARKER).length - 1;
  if (uptoCount > 1) return { error: "old text contains more than one [upto] marker" };

  if (uptoCount === 0) {
    if (old.length === 0) return { error: "old text anchor is empty" };
    const occ = findOccurrences(text, old);
    if (occ.length === 0) return { error: "old text anchor not found" };
    if (occ.length > 1) return { error: "old text anchor is not unique" };
    return { start: occ[0], end: occ[0] + old.length };
  }

  let [head, tail] = old.split(UPTO_MARKER);
  // strip a single leading newline/CR from the tail right after the marker
  tail = tail.replace(/^\r\n|^\r|^\n/, "");
  if (tail.trim().length === 0) {
    return { error: "old text after [upto] must include a unique tail anchor" };
  }
  if (head.length === 0) return { error: "old text anchor is empty" };

  const headOcc = findOccurrences(text, head);
  if (headOcc.length === 0) return { error: "old text anchor not found" };
  if (headOcc.length > 1) return { error: "old text anchor is not unique" };
  const headStart = headOcc[0];
  const headEnd = headStart + head.length;

  const tailOcc = findOccurrences(text, tail, headEnd);
  if (tailOcc.length === 0) return { error: "old text after [upto] tail anchor not found" };
  if (tailOcc.length > 1) return { error: "old text after [upto] tail anchor is not unique" };
  const tailStart = tailOcc[0];
  const tailEnd = tailStart + tail.length;

  return { start: headStart, end: tailEnd };
}

function lineNumberAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text[i] === "\n") line++;
  return line;
}

function renderContext(newText: string, editStartLine: number, editEndLine: number): string {
  const lines = newText.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "" && newText.endsWith("\n")) {
    lines.pop();
  }
  const from = Math.max(1, editStartLine - CONTEXT_BEFORE);
  const to = Math.min(lines.length, editEndLine + CONTEXT_AFTER);

  const editSpan = editEndLine - editStartLine + 1;
  const out: string[] = [];

  const emit = (from: number, to: number) => {
    for (let ln = from; ln <= to; ln++) out.push(`${ln} ${lines[ln - 1] ?? ""}`);
  };

  if (editSpan > LARGE_EDIT_THRESHOLD) {
    emit(from, editStartLine + LARGE_EDIT_HEAD_TAIL - 1);
    const omitted = editSpan - LARGE_EDIT_HEAD_TAIL * 2;
    out.push(`... ${omitted} lines omitted ...`);
    emit(editEndLine - LARGE_EDIT_HEAD_TAIL + 1, to);
  } else {
    emit(from, to);
  }

  return out.join("\n") + "\n";
}

export async function toolEdit(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const rawPath = args.path as string | undefined;
  const old = args.old as string | undefined;
  const next = args.new as string | undefined;
  if (!rawPath) return { content: "Tool error: edit requires path\n", isError: true };
  if (old === undefined) return { content: "Tool error: edit requires old\n", isError: true };
  if (next === undefined) return { content: "Tool error: edit requires new\n", isError: true };

  const filePath = path.resolve(ctx.cwd, rawPath);
  let text: string;
  try {
    text = (await readFile(filePath)).toString("utf-8");
  } catch (err: any) {
    return { content: `Tool error: open ${rawPath}: ${err.message}\n`, isError: true };
  }

  const span = resolveSpan(text, old);
  if ("error" in span) {
    return { content: `Tool error: ${span.error}\n`, isError: true };
  }

  const before = text.slice(0, span.start);
  const after = text.slice(span.end);
  const newText = before + next + after;

  const denied = await requireConfirmation(
    ctx,
    "edit",
    `Edit ${rawPath}`,
    `--- old ---\n${old}\n--- new ---\n${next}`,
  );
  if (denied) return denied;

  try {
    await writeFile(filePath, newText, "utf-8");
  } catch (err: any) {
    return { content: `Tool error: write failed: ${err.message}\n`, isError: true };
  }

  const editStartLine = lineNumberAt(newText, before.length);
  const editEndLine = lineNumberAt(newText, before.length + next.length);
  const mode = old.includes(UPTO_MARKER) ? "anchored old/new replacement" : "old/new replacement";

  const header = `Edited ${rawPath} using ${mode}\n`;
  const context = renderContext(newText, editStartLine, editEndLine);

  return { content: header + context };
}
