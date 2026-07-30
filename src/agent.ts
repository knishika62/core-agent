import { config } from "./config.js";
import { chatCompletionStream } from "./llmClient.js";
import { executeToolCall, toolDefinitions, ToolContext } from "./tools/index.js";
import { maybeCompact } from "./compaction.js";
import { loadSkills } from "./skills.js";
import type { Message } from "./types.js";

export interface RunTurnOptions {
  onTextDelta?: (text: string) => void;
  onToolCall?: (name: string, args: string) => void;
  onToolResult?: (name: string, content: string) => void;
  onCompact?: () => void;
  onError?: (err: unknown) => void;
  /** ESC-to-interrupt: aborts only the in-flight LLM request. Whatever text
   *  had already streamed in in is kept as the assistant's message (not
   *  discarded), and the turn ends there — no tool call that was still
   *  being assembled runs half-specified. */
  abortSignal?: AbortSignal;
}

/**
 * Mirrors ds4_agent.c's worker_run_turn: repeatedly call the model, and if it
 * asks for tool calls, execute them and feed the results back, until it
 * produces a plain stop.
 */
export async function runTurn(
  messages: Message[],
  ctx: ToolContext,
  options: RunTurnOptions = {},
): Promise<Message[]> {
  const endpoint = {
    baseUrl: config.main.baseUrl,
    apiKey: config.main.apiKey,
    model: config.main.model,
    protocol: config.main.protocol,
  };

  for (let round = 0; round < config.maxToolRounds; round++) {
    if (await maybeCompact(messages)) options.onCompact?.();

    // Skills are otherwise scanned once at process startup only, so a
    // skill.json authored mid-session (e.g. the model writing its own skill)
    // would never show up in `tools` below without a restart. Re-scanning
    // here — same "don't cache, re-read every time" call as hooks.json —
    // costs two readdir()s per round, cheap enough to not bother gating it.
    await loadSkills(ctx.cwd);

    // A transient network blip (DNS hiccup, TLS reset, etc.) talking to the
    // LLM endpoint used to crash the whole process — killing an entire REPL
    // session over one flaky request is far worse than just reporting the
    // failure and letting the user retry.
    let result;
    try {
      result = await chatCompletionStream(endpoint, messages, {
        tools: toolDefinitions,
        onTextDelta: options.onTextDelta,
        signal: options.abortSignal,
      });
    } catch (err) {
      options.onError?.(err);
      const message = err instanceof Error ? err.message : String(err);
      messages.push({
        role: "assistant",
        content: `[LLM request failed: ${message}. Send your message again to retry.]`,
      });
      return messages;
    }

    messages.push({
      role: "assistant",
      content: result.content,
      toolCalls: result.toolCalls.length ? result.toolCalls : undefined,
    });

    // ESC hit mid-stream: whatever text had already arrived is kept above,
    // but the turn ends right here regardless of what the (possibly
    // incomplete) response looked like — no tool call gets run off the
    // back of a request the user just told the harness to abandon.
    if (result.aborted) {
      return messages;
    }

    if (result.toolCalls.length === 0) {
      return messages;
    }

    for (const call of result.toolCalls) {
      options.onToolCall?.(call.name, call.arguments);
      const toolResult = await executeToolCall(call, ctx);
      options.onToolResult?.(call.name, toolResult.content);
      messages.push({
        role: "tool",
        content: toolResult.content,
        toolCallId: call.id,
        name: call.name,
      });
    }
  }

  messages.push({
    role: "assistant",
    content: `[stopped after ${config.maxToolRounds} tool rounds without a final answer]`,
  });
  return messages;
}
