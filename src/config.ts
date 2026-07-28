import type { Protocol } from "./llmClient.js";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function protocolFromEnv(name: string): Protocol {
  return process.env[name] === "anthropic" ? "anthropic" : "openai";
}

// A mutable object (not per-field constants) so it can be exported once and
// populated later by initConfig() — callers do `import { config }` and read
// config.xxx at call time, same as before. This indirection exists because
// process.env isn't populated yet at module-evaluation time: envLoader.ts's
// loadEnvFile() (cwd .env -> ~/.core-agent/.env fallback, possibly a
// first-run bootstrap) has to run first, and that can only happen inside
// main()'s body — well after this module's static imports have already been
// evaluated. Reading process.env directly into top-level consts here (the
// old shape) would always see it empty.
export const config = {
  main: { baseUrl: "", apiKey: "", model: "", protocol: "openai" as Protocol },
  vision: { baseUrl: "", apiKey: "", model: "" },
  maxToolRounds: 50,
  maxContextTokens: 60_000,
  pythonPath: "",
  searchEngineUrl: "",
  guiHost: "0.0.0.0",
  guiPort: 8787,
  guiInlineMedia: true,
};

/** Call once, after loadEnvFile() has populated process.env, and before
 *  anything reads config.xxx. */
export function initConfig(): void {
  config.main.baseUrl = required("OPENAI_BASE_URL", "http://127.0.0.1:8000/v1");
  config.main.apiKey = process.env.OPENAI_API_KEY ?? "";
  config.main.model = required("LLM_MODEL", "deepseek-v4-flash");
  // LLM_PROTOCOL=anthropic switches this endpoint to /v1/messages semantics
  // (Anthropic-compatible), instead of OpenAI's /v1/chat/completions.
  config.main.protocol = protocolFromEnv("LLM_PROTOCOL");
  config.vision.baseUrl = process.env.VISION_BASE_URL ?? "";
  config.vision.apiKey = process.env.VISION_API_KEY ?? "";
  config.vision.model = process.env.VISION_MODEL ?? "";
  config.maxToolRounds = Number(process.env.MAX_TOOL_ROUNDS ?? 50);
  // Rough token-budget threshold (chars/4 estimate, not a real tokenizer)
  // past which maybeCompact() summarizes older history. Conservative
  // default well under most models' context windows.
  config.maxContextTokens = Number(process.env.MAX_CONTEXT_TOKENS ?? 60_000);
  // Absolute path to a Python interpreter (typically inside a venv the user
  // manages themselves) the agent should be told to use for ad-hoc scripts,
  // instead of reaching for whatever "python"/"python3" happens to be on
  // PATH and pip-installing into it unprompted.
  config.pythonPath = process.env.PYTHON_PATH ?? "";
  // If set, google_search hits this HTTP JSON endpoint (e.g. a self-hosted
  // SearXNG instance) instead of driving a real Chrome against google.com —
  // no browser warmup/bot-detection concerns at all on that path.
  config.searchEngineUrl = process.env.SEARCH_ENGINE_URL ?? "";
  // Web GUI (src/webServer.ts) listen address/port. Defaults to all
  // interfaces so it's reachable from other devices on the LAN by default;
  // both are overridable per the usual .env pattern.
  config.guiHost = process.env.GUI_HOST ?? "0.0.0.0";
  config.guiPort = Number(process.env.GUI_PORT ?? 8787);
  // show_media results render inline in the session (image/video/audio
  // streamed from the server over HTTP) by default — this is what makes
  // show_media work at all when the browser is on a different machine than
  // the server (LAN access), since opening a native app is always local to
  // wherever the server process runs. Set to "0" to disable if you'd rather
  // not have the server stream arbitrary file contents over HTTP (same
  // no-auth trust model as the rest of the GUI, but an explicit opt-out for
  // anyone who wants one).
  config.guiInlineMedia = process.env.GUI_INLINE_MEDIA !== "0";
}

export function visionConfigured(): boolean {
  return Boolean(config.vision.baseUrl && config.vision.model);
}
