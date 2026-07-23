import { config } from "./config.js";
import { chatCompletionStream } from "./llmClient.js";
import { executeToolCall, toolDefinitions, ToolContext } from "./tools/index.js";
import { maybeCompact } from "./compaction.js";
import type { Message } from "./types.js";

export interface RunTurnOptions {
  onTextDelta?: (text: string) => void;
  onToolCall?: (name: string, args: string) => void;
  onToolResult?: (name: string, content: string) => void;
  onCompact?: () => void;
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

    const result = await chatCompletionStream(endpoint, messages, {
      tools: toolDefinitions,
      onTextDelta: options.onTextDelta,
    });

    messages.push({
      role: "assistant",
      content: result.content,
      toolCalls: result.toolCalls.length ? result.toolCalls : undefined,
    });

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
