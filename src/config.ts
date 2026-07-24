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
}

export function visionConfigured(): boolean {
  return Boolean(config.vision.baseUrl && config.vision.model);
}
