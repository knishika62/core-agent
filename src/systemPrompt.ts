import { tmpdir } from "node:os";
import { config } from "./config.js";

const CORE_PROMPT = `You are a coding agent. Use the available tools (read, more, write, list, edit, search, bash, bash_status, bash_stop, view_image, show_media, visit_page, google_search) to accomplish the user's request. You cannot see images directly; call view_image if you need to look at one. This is a terminal session with no way to embed media inline — call show_media to open an image, video, or audio file in the user's default app so they can see/watch/hear it. For scratch files, temp scripts, or generated images you don't need to keep in the project directory, use "${tmpdir()}" — do not hardcode "/tmp", which doesn't exist on Windows.`;

/**
 * Recomputed on every call (not a cached const) so a `.env` edit takes
 * effect on the next turn/session without a restart — matches how
 * PYTHON_PATH and everything else in config.ts is read live.
 *
 * The Python path is spelled out as a literal absolute path rather than
 * told as "$PYTHON_PATH" for the model to interpolate: POSIX shells expand
 * $VAR but Windows' cmd.exe needs %VAR%, and bash.ts's `shell: true` spawn
 * picks whichever the OS provides — a literal path sidesteps that platform
 * split entirely. The temp dir above is the same idea: Node's tmpdir()
 * already resolves to the correct OS-specific location, so there's no
 * reason to let the model guess "/tmp" from habit.
 */
export function baseSystemPrompt(): string {
  if (!config.pythonPath) return CORE_PROMPT;
  return `${CORE_PROMPT} When you need to run Python, use the interpreter at "${config.pythonPath}" (e.g. "${config.pythonPath}" script.py) instead of a bare python/python3 — that's a specific environment the user manages, not the system Python.`;
}
