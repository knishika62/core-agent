import { chatCompletion } from "./llmClient.js";
import { config } from "./config.js";
import type { Message } from "./types.js";

const MIN_KEEP_MESSAGES = 10;
const CHARS_PER_TOKEN_ESTIMATE = 4; // rough, tokenizer-agnostic heuristic

function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length;
    for (const tc of m.toolCalls ?? []) chars += tc.arguments.length;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE);
}

/**
 * Finds the first safe boundary to cut at, no earlier than
 * `length - minKeep`. Safe means: a plain "user" message, which is always
 * the start of a fresh turn — cutting there can never separate an
 * assistant's tool_calls from their tool results (which would produce an
 * invalid request to the API).
 */
export function findSafeCutIndex(messages: Message[], minKeep: number): number {
  let idx = Math.max(1, messages.length - minKeep); // never touch index 0 (system prompt)
  while (idx < messages.length && messages[idx].role !== "user") idx++;
  return idx;
}

/**
 * Mirrors ds4_agent.c's agent_worker_compact: once the transcript gets too
 * large, summarize the older portion (keeping the system prompt and a
 * recent window verbatim) so long sessions don't eventually overflow the
 * model's context window. Mutates `messages` in place so callers holding
 * the same array reference (cli.ts, session persistence) stay in sync.
 */
export async function maybeCompact(messages: Message[]): Promise<boolean> {
  if (estimateTokens(messages) < config.maxContextTokens) return false;

  const cutIndex = findSafeCutIndex(messages, MIN_KEEP_MESSAGES);
  if (cutIndex <= 1 || cutIndex >= messages.length) return false;

  const toSummarize = messages.slice(1, cutIndex);
  if (toSummarize.length === 0) return false;

  const endpoint = {
    baseUrl: config.main.baseUrl,
    apiKey: config.main.apiKey,
    model: config.main.model,
    protocol: config.main.protocol,
  };

  const transcript = toSummarize
    .map((m) => `[${m.role}]${m.name ? ` (${m.name})` : ""} ${m.content}`)
    .join("\n\n");

  const result = await chatCompletion(endpoint, [
    {
      role: "system",
      content:
        "Summarize the following conversation history concisely but completely: preserve important " +
        "facts, decisions, file paths, and open tasks. This summary will permanently replace the " +
        "original messages, so don't drop anything a later turn might need.",
    },
    { role: "user", content: transcript },
  ]);

  const summaryMessage: Message = {
    role: "user",
    content: `[Earlier conversation summary, ${toSummarize.length} messages compacted]\n${result.content}`,
  };

  messages.splice(1, cutIndex - 1, summaryMessage);
  return true;
}
