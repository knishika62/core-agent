import { stdout } from "node:process";
import { color, ansiEnabled } from "./cliColors.js";

/** Inline **bold**, *italic*, `code`, ~~strike~~, [text](url) → ANSI. Order
 *  matters: code spans and bold are consumed before the single-`*`/`_`
 *  italic regex runs, so a leftover single asterisk can only be a genuine
 *  italic marker. */
function renderInline(text: string): string {
  let out = text;
  out = out.replace(/`([^`]+)`/g, (_, code) => color.code(code));
  out = out.replace(/\*\*([^*]+)\*\*/g, (_, b) => color.bold(b));
  out = out.replace(/__([^_]+)__/g, (_, b) => color.bold(b));
  out = out.replace(/~~([^~]+)~~/g, (_, s) => color.strike(s));
  out = out.replace(/\*([^*]+)\*/g, (_, i) => color.italic(i));
  out = out.replace(/(?<![\w`])_([^_]+)_(?![\w`])/g, (_, i) => color.italic(i));
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, url) => `${color.underline(t)} ${color.dim(`(${url})`)}`);
  return out;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const HR_RE = /^(-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET_RE = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED_RE = /^(\s*)(\d+)\.\s+(.*)$/;
const FENCE_RE = /^```/;

/**
 * Line-buffered Markdown → ANSI renderer for streamed LLM output. Full
 * Markdown parsing needs the whole document (e.g. to know where a fenced
 * code block ends); this instead renders as soon as each line is complete,
 * which keeps the streaming feel and covers the constructs models actually
 * use in chat responses (headings, lists, emphasis, code fences, quotes,
 * links). Tables are intentionally left as raw text — not worth the
 * complexity for a "simple viewer".
 */
export class MarkdownStreamRenderer {
  private buffer = "";
  private insideFence = false;

  write(chunk: string): void {
    if (!ansiEnabled) {
      stdout.write(chunk);
      return;
    }
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      this.renderLine(line);
      stdout.write("\n");
    }
  }

  /** Flush any trailing partial line (call between tool calls and at the
   *  end of a turn — a code fence should never legitimately stay open
   *  across those boundaries). */
  flush(): void {
    if (this.buffer) {
      if (!ansiEnabled) {
        stdout.write(this.buffer);
      } else {
        this.renderLine(this.buffer);
      }
      this.buffer = "";
    }
    this.insideFence = false;
  }

  private renderLine(line: string): void {
    if (FENCE_RE.test(line)) {
      this.insideFence = !this.insideFence;
      stdout.write(color.dim(line));
      return;
    }
    if (this.insideFence) {
      stdout.write(color.codeBlock(line));
      return;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      stdout.write(color.heading(heading[2]));
      return;
    }
    if (HR_RE.test(line)) {
      stdout.write(color.dim("─".repeat(40)));
      return;
    }
    const quote = line.match(QUOTE_RE);
    if (quote) {
      stdout.write(color.dim("│ ") + color.italic(renderInline(quote[1])));
      return;
    }
    const bullet = line.match(BULLET_RE);
    if (bullet) {
      stdout.write(`${bullet[1]}${color.bold("•")} ${renderInline(bullet[2])}`);
      return;
    }
    const ordered = line.match(ORDERED_RE);
    if (ordered) {
      stdout.write(`${ordered[1]}${color.bold(`${ordered[2]}.`)} ${renderInline(ordered[3])}`);
      return;
    }
    stdout.write(renderInline(line));
  }
}
