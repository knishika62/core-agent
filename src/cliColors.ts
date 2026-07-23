import { stdout } from "node:process";

// Disabled automatically for non-TTY output (piped/redirected) so logs and
// scripted runs don't get raw escape codes, and honors the NO_COLOR
// convention (https://no-color.org/).
export const ansiEnabled = Boolean(stdout.isTTY) && !process.env.NO_COLOR;

function wrap(code: string) {
  return (text: string) => (ansiEnabled ? `\x1b[${code}m${text}\x1b[0m` : text);
}

export const color = {
  // Bold cyan: the user's own input prompt.
  user: wrap("1;36"),
  // Default/bold white: the agent's spoken response.
  agent: wrap("1;37"),
  // Dim gray: tool-call/tool-result and system chrome (session info, etc).
  dim: wrap("2"),
  // Yellow: confirmation prompts.
  warn: wrap("33"),
  // Red: errors.
  error: wrap("31"),
  // Green: success/progress notices (e.g. browser warmup finished).
  success: wrap("32"),
  // Markdown rendering.
  bold: wrap("1"),
  italic: wrap("3"),
  underline: wrap("4"),
  strike: wrap("9"),
  code: wrap("36"), // cyan, inline code spans
  codeBlock: wrap("32"), // green, fenced code block lines
  heading: wrap("1;4"), // bold+underline
};

export const rawColor = {
  agentStart: ansiEnabled ? "\x1b[1;37m" : "",
  reset: ansiEnabled ? "\x1b[0m" : "",
};
