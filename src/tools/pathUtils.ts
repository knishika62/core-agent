/**
 * Terminals that support drag-and-drop (iTerm2, Terminal.app, Ghostty, ...)
 * insert a dropped file's path as raw shell-escaped text — either
 * backslash-escaped spaces/specials ("My\ File.png") or wrapped in matching
 * quotes ("'My File.png'"), depending on the terminal. The model may relay
 * that text to a tool's path argument verbatim, so undo both conventions
 * before treating it as a filesystem path.
 */
export function cleanDroppedPath(input: string): string {
  let s = input.trim();
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      s = s.slice(1, -1);
    }
  }
  return s.replace(/\\(.)/g, "$1");
}

/** Cheap binary-file heuristic (text files essentially never contain a NUL
 *  byte, binary ones almost always do near the start) — shared by search.ts
 *  (excluding binary files from results) and read.ts (rejecting them
 *  outright instead of decoding raw bytes as garbage "text"). */
export function isBinary(buf: Buffer): boolean {
  return buf.includes(0);
}
