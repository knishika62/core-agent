import type { ToolCall, ToolDefinition, ToolResult } from "../types.js";
import { ToolContext } from "./context.js";
import { toolRead, toolMore } from "./read.js";
import { toolWrite } from "./write.js";
import { toolList } from "./list.js";
import { toolEdit } from "./edit.js";
import { toolSearch } from "./search.js";
import { toolBash, toolBashStatus, toolBashStop } from "./bash.js";
import { toolViewImage } from "./viewImage.js";
import { toolVisitPage } from "./visitPage.js";
import { toolGoogleSearch } from "./googleSearch.js";
import { toolShowMedia } from "./showMedia.js";
import { runPreToolUseHooks, runPostToolUseHooks } from "../hooks.js";

export { ToolContext } from "./context.js";

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "read",
    description: "Read a text file, optionally starting at a given line.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        start_line: { type: "number" },
        max_lines: { type: "number" },
        whole: { type: "boolean" },
        raw: { type: "boolean" },
      },
      required: ["path"],
    },
  },
  {
    name: "more",
    description: "Continue a previous truncated read or search output.",
    parameters: {
      type: "object",
      properties: { count: { type: "number" } },
    },
  },
  {
    name: "write",
    description: "Write (overwrite) a file with the given content.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list",
    description: "List directory entries (non-recursive).",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
    },
  },
  {
    name: "edit",
    description:
      "Replace a unique occurrence of `old` with `new` in a file. `old` may contain a single [upto] marker to anchor on a head/tail pair instead of an exact block.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old: { type: "string" },
        new: { type: "string" },
      },
      required: ["path", "old", "new"],
    },
  },
  {
    name: "search",
    description: "Search files for a literal string or regex, recursively.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string" },
        mode: { type: "string", enum: ["literal", "regex"] },
        glob: { type: "string" },
        context: { type: "number" },
        max_results: { type: "number" },
        case_sensitive: { type: "boolean" },
      },
      required: ["query"],
    },
  },
  {
    name: "bash",
    description: "Run a shell command asynchronously; long-running commands become a background job.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout_sec: { type: "number" },
        refresh_sec: { type: "number" },
      },
      required: ["command"],
    },
  },
  {
    name: "bash_status",
    description: "Check the status/output of a background bash job.",
    parameters: {
      type: "object",
      properties: {
        job: { type: "number" },
        pid: { type: "number" },
        refresh_sec: { type: "number" },
      },
    },
  },
  {
    name: "bash_stop",
    description: "Stop a background bash job (SIGTERM, then SIGKILL if needed).",
    parameters: {
      type: "object",
      properties: {
        job: { type: "number" },
        pid: { type: "number" },
        refresh_sec: { type: "number" },
      },
    },
  },
  {
    name: "visit_page",
    description: "Navigate to a URL in a real browser and return its visible content as Markdown.",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "google_search",
    description: "Search Google and return visible result links plus a text snapshot.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "view_image",
    description:
      "Ask a vision-capable fallback model a question about an image (local path or URL). Use this only when you need to see image content; the main model cannot read images directly.",
    parameters: {
      type: "object",
      properties: {
        path_or_url: { type: "string" },
        question: { type: "string" },
      },
      required: ["path_or_url"],
    },
  },
  {
    name: "show_media",
    description:
      "Open a local image, video, or audio file in the user's default application, so the user (not the model) can see/watch/hear it. This is a terminal session — there is no way to embed media inline — so use this whenever the user should look at or play a file you created or found.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
];

export type ToolFn = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

const handlers: Record<string, ToolFn> = {
  read: toolRead,
  more: toolMore,
  write: toolWrite,
  list: toolList,
  edit: toolEdit,
  search: toolSearch,
  bash: toolBash,
  bash_status: toolBashStatus,
  bash_stop: toolBashStop,
  view_image: toolViewImage,
  visit_page: toolVisitPage,
  google_search: toolGoogleSearch,
  show_media: toolShowMedia,
};

/**
 * Lets skills (src/skills.ts) add tools at startup without this module
 * needing to know anything about skills. `toolDefinitions` and `handlers`
 * are mutated in place (never reassigned), so every existing import of
 * `toolDefinitions` — agent.ts's runTurn, cli.ts's /help — sees the
 * addition automatically via ESM's live bindings.
 */
export function registerTool(definition: ToolDefinition, handler: ToolFn): boolean {
  if (handlers[definition.name]) {
    console.error(`[core-agent] skipping tool "${definition.name}": a tool with that name already exists`);
    return false;
  }
  toolDefinitions.push(definition);
  handlers[definition.name] = handler;
  return true;
}

export async function executeToolCall(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
  const handler = handlers[call.name];
  if (!handler) {
    return { content: `Tool error: unknown tool ${call.name}\n`, isError: true };
  }
  let args: Record<string, unknown>;
  try {
    args = call.arguments ? JSON.parse(call.arguments) : {};
  } catch (err: any) {
    // The most common real cause isn't a formatting mistake: the model's
    // own response got cut off mid-string by a token/length limit while
    // generating one huge tool call (e.g. a full file's contents as a
    // single `write` argument) — the resulting JSON is truncated and can
    // never parse, no matter how it's retried the same way. A plain
    // "invalid JSON" error gives no way to tell the two apart, so a
    // regular user has no way to know what to do about it either.
    const looksTruncated = /Unterminated string|Unexpected end of (JSON input|input)/i.test(err.message);
    const hint = looksTruncated
      ? " This looks like the response was cut off mid-generation (a token/length limit), not a formatting mistake — " +
        "retrying the exact same call will likely fail the same way. Break the work into multiple smaller tool calls " +
        "instead: write a shorter first version, then use `edit` to add each additional section afterward."
      : "";
    return { content: `Tool error: invalid arguments JSON: ${err.message}.${hint}\n`, isError: true };
  }

  const pre = await runPreToolUseHooks(ctx.cwd, call.name, call.arguments ?? "{}");
  if (pre.blocked) {
    return { content: `Tool error: blocked by pre-tool-use hook: ${pre.reason}\n`, isError: true };
  }

  let result: ToolResult;
  try {
    result = await handler(args, ctx);
  } catch (err: any) {
    result = { content: `Tool error: ${err.message}\n`, isError: true };
  }

  await runPostToolUseHooks(ctx.cwd, call.name, call.arguments ?? "{}", result.content, Boolean(result.isError));

  return result;
}
