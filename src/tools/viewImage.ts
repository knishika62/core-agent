import { readFile } from "node:fs/promises";
import path from "node:path";
import { config, visionConfigured } from "../config.js";
import type { ToolResult } from "../types.js";
import type { ToolContext } from "./context.js";

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * Terminals that support drag-and-drop (iTerm2, Terminal.app, ...) insert a
 * dropped file's path as raw shell-escaped text — either backslash-escaped
 * spaces/specials ("My\ File.png") or wrapped in matching quotes
 * ("'My File.png'"), depending on the terminal. The model may relay that
 * text to view_image's path_or_url verbatim, so undo both conventions
 * before treating it as a filesystem path.
 */
function cleanDroppedPath(input: string): string {
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

async function resolveImageUrl(pathOrUrl: string, cwd: string): Promise<string> {
  const trimmed = pathOrUrl.trim();
  if (/^https?:\/\//.test(trimmed)) return trimmed;
  const filePath = path.resolve(cwd, cleanDroppedPath(pathOrUrl));
  const ext = path.extname(filePath).toLowerCase();
  const mime = EXT_TO_MIME[ext] ?? "application/octet-stream";
  const data = await readFile(filePath);
  return `data:${mime};base64,${data.toString("base64")}`;
}

/**
 * Vision is implemented as a synthetic tool call rather than a mid-turn model
 * switch: the main model asks a one-shot question about an image and gets a
 * text answer back, with no conversation history handed to the vision model.
 */
export async function toolViewImage(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const pathOrUrl = args.path_or_url as string | undefined;
  const question = (args.question as string | undefined) ?? "Describe this image in detail.";
  if (!pathOrUrl) return { content: "Tool error: view_image requires path_or_url\n", isError: true };
  if (!visionConfigured()) {
    return {
      content: "Tool error: view_image is not configured (set VISION_BASE_URL and VISION_MODEL)\n",
      isError: true,
    };
  }

  let imageUrl: string;
  try {
    imageUrl = await resolveImageUrl(pathOrUrl, ctx.cwd);
  } catch (err: any) {
    return { content: `Tool error: could not read image: ${err.message}\n`, isError: true };
  }

  const res = await fetch(`${config.vision.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.vision.apiKey ? { Authorization: `Bearer ${config.vision.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.vision.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: question },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      stream: false,
    }),
  });

  if (!res.ok) {
    return { content: `Tool error: view_image request failed: ${res.status} ${await res.text()}\n`, isError: true };
  }
  const data: any = await res.json();
  const answer = data.choices?.[0]?.message?.content ?? "";
  return { content: answer };
}
