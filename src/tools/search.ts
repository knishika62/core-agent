import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolResult } from "../types.js";
import type { ToolContext } from "./context.js";

const MAX_DEPTH = 24;

function globToRegExp(glob: string): RegExp {
  let re = "";
  for (const ch of glob) {
    if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

async function walk(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, depth + 1, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

function isBinary(buf: Buffer): boolean {
  return buf.includes(0);
}

interface Match {
  file: string;
  lineRanges: { start: number; end: number; lines: string[] }[];
}

export async function toolSearch(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const query = args.query as string | undefined;
  if (!query) return { content: "Tool error: search requires query\n", isError: true };

  const searchPath = path.resolve(ctx.cwd, (args.path as string | undefined) ?? ".");
  const mode = (args.mode as string | undefined) ?? "literal";
  const globPattern = args.glob as string | undefined;
  const contextLines = Math.min(5, Math.max(0, Number(args.context ?? 0)));
  const maxResults = Math.min(500, Math.max(1, Number(args.max_results ?? 50)));
  const caseSensitive = args.case_sensitive === undefined ? true : Boolean(args.case_sensitive);

  let matcher: (line: string) => boolean;
  if (mode === "regex") {
    let regex: RegExp;
    try {
      regex = new RegExp(query, caseSensitive ? "" : "i");
    } catch (err: any) {
      return { content: `Tool error: invalid regex: ${err.message}\n`, isError: true };
    }
    matcher = (line) => regex.test(line);
  } else {
    const needle = caseSensitive ? query : query.toLowerCase();
    matcher = (line) => (caseSensitive ? line : line.toLowerCase()).includes(needle);
  }

  const globRegex = globPattern ? globToRegExp(globPattern) : null;

  const files: string[] = [];
  await walk(searchPath, 0, files);

  let totalMatches = 0;
  const results: Match[] = [];

  outer: for (const file of files) {
    if (globRegex && !globRegex.test(path.basename(file)) && !globRegex.test(file)) continue;

    let buf: Buffer;
    try {
      buf = await readFile(file);
    } catch {
      continue;
    }
    if (isBinary(buf)) continue;

    const lines = buf.toString("utf-8").split(/\r\n|\r|\n/);
    const hitLines: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (matcher(lines[i])) hitLines.push(i + 1);
    }
    if (hitLines.length === 0) continue;

    const ranges: { start: number; end: number; lines: string[] }[] = [];
    for (const ln of hitLines) {
      const start = Math.max(1, ln - contextLines);
      const end = Math.min(lines.length, ln + contextLines);
      const last = ranges[ranges.length - 1];
      if (last && start <= last.end + 1) {
        last.end = Math.max(last.end, end);
      } else {
        ranges.push({ start, end, lines: [] });
      }
      totalMatches++;
      if (totalMatches >= maxResults) break;
    }
    for (const r of ranges) r.lines = lines.slice(r.start - 1, r.end);
    results.push({ file, lineRanges: ranges });

    if (totalMatches >= maxResults) break outer;
  }

  if (results.length === 0) return { content: "No matches\n" };

  const out: string[] = [`${totalMatches} matches shown\n`];
  for (const m of results) {
    out.push(m.file);
    for (const r of m.lineRanges) {
      for (let i = 0; i < r.lines.length; i++) {
        out.push(`  ${r.start + i} ${r.lines[i]}`);
      }
    }
    out.push("");
  }

  return { content: out.join("\n") };
}
