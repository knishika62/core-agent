import "dotenv/config";
import type { Protocol } from "./llmClient.js";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function protocolFromEnv(name: string): Protocol {
  return process.env[name] === "anthropic" ? "anthropic" : "openai";
}

export const config = {
  main: {
    baseUrl: required("OPENAI_BASE_URL", "http://127.0.0.1:8000/v1"),
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: required("LLM_MODEL", "deepseek-v4-flash"),
    // LLM_PROTOCOL=anthropic switches this endpoint to /v1/messages semantics
    // (Anthropic-compatible), instead of OpenAI's /v1/chat/completions.
    protocol: protocolFromEnv("LLM_PROTOCOL"),
  },
  vision: {
    baseUrl: process.env.VISION_BASE_URL ?? "",
    apiKey: process.env.VISION_API_KEY ?? "",
    model: process.env.VISION_MODEL ?? "",
  },
  maxToolRounds: Number(process.env.MAX_TOOL_ROUNDS ?? 50),
  // Rough token-budget threshold (chars/4 estimate, not a real tokenizer)
  // past which maybeCompact() summarizes older history. Conservative
  // default well under most models' context windows.
  maxContextTokens: Number(process.env.MAX_CONTEXT_TOKENS ?? 60_000),
};

export function visionConfigured(): boolean {
  return Boolean(config.vision.baseUrl && config.vision.model);
}
