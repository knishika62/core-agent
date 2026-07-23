import type { Message, ToolCall, ToolDefinition } from "./types.js";

export type Protocol = "openai" | "anthropic";

interface EndpointConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol?: Protocol;
}

interface CompletionResult {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string;
  /** Set when options.signal fired mid-stream: whatever text had already
   *  streamed in is returned as-is (so it isn't lost), but any tool call
   *  still being assembled is dropped rather than run half-specified. */
  aborted?: boolean;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

interface CompletionOptions {
  tools?: ToolDefinition[];
  onTextDelta?: (text: string) => void;
  signal?: AbortSignal;
}

function toOpenAiMessages(messages: Message[]) {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

function toOpenAiTools(tools: ToolDefinition[] | undefined) {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

// ---- Anthropic /v1/messages support ----

function toAnthropicMessages(messages: Message[]): { system: string; messages: any[] } {
  const system: string[] = [];
  const out: any[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m.role === "system") {
      system.push(m.content);
      i++;
      continue;
    }
    if (m.role === "tool") {
      const toolResults: any[] = [];
      while (i < messages.length && messages[i].role === "tool") {
        const tm = messages[i];
        toolResults.push({ type: "tool_result", tool_use_id: tm.toolCallId, content: tm.content });
        i++;
      }
      out.push({ role: "user", content: toolResults });
      continue;
    }
    if (m.role === "assistant") {
      const content: any[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls ?? []) {
        let input: unknown = {};
        try {
          input = tc.arguments ? JSON.parse(tc.arguments) : {};
        } catch {
          input = {};
        }
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input });
      }
      out.push({ role: "assistant", content: content.length ? content : m.content });
      i++;
      continue;
    }
    out.push({ role: "user", content: m.content });
    i++;
  }
  return { system: system.join("\n\n"), messages: out };
}

function toAnthropicTools(tools: ToolDefinition[] | undefined) {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

function anthropicHeaders(endpoint: EndpointConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": endpoint.apiKey,
    "anthropic-version": "2023-06-01",
  };
}

async function anthropicChatCompletion(
  endpoint: EndpointConfig,
  messages: Message[],
  options: CompletionOptions,
): Promise<CompletionResult> {
  const { system, messages: amsgs } = toAnthropicMessages(messages);
  const res = await fetch(`${endpoint.baseUrl}/messages`, {
    method: "POST",
    headers: anthropicHeaders(endpoint),
    body: JSON.stringify({
      model: endpoint.model,
      system: system || undefined,
      messages: amsgs,
      tools: toAnthropicTools(options.tools),
      max_tokens: 8192,
      stream: false,
    }),
    signal: options.signal,
  });
  if (!res.ok) {
    throw new Error(`LLM request failed: ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  const data: any = await res.json();
  let content = "";
  const toolCalls: ToolCall[] = [];
  for (const block of data.content ?? []) {
    if (block.type === "text") content += block.text;
    else if (block.type === "tool_use") {
      toolCalls.push({ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) });
    }
  }
  return { content, toolCalls, finishReason: data.stop_reason ?? "stop" };
}

async function anthropicChatCompletionStream(
  endpoint: EndpointConfig,
  messages: Message[],
  options: CompletionOptions,
): Promise<CompletionResult> {
  const { system, messages: amsgs } = toAnthropicMessages(messages);
  const res = await fetch(`${endpoint.baseUrl}/messages`, {
    method: "POST",
    headers: anthropicHeaders(endpoint),
    body: JSON.stringify({
      model: endpoint.model,
      system: system || undefined,
      messages: amsgs,
      tools: toAnthropicTools(options.tools),
      max_tokens: 8192,
      stream: true,
    }),
    signal: options.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`LLM request failed: ${res.status} ${res.statusText}: ${await res.text()}`);
  }

  let content = "";
  const blocks = new Map<number, { type: string; id?: string; name?: string; jsonBuf: string }>();
  let stopReason = "stop";

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let aborted = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;

        const evt = JSON.parse(payload);
        if (evt.type === "content_block_start") {
          blocks.set(evt.index, {
            type: evt.content_block.type,
            id: evt.content_block.id,
            name: evt.content_block.name,
            jsonBuf: "",
          });
        } else if (evt.type === "content_block_delta") {
          const b = blocks.get(evt.index);
          if (evt.delta.type === "text_delta") {
            content += evt.delta.text;
            options.onTextDelta?.(evt.delta.text);
          } else if (evt.delta.type === "input_json_delta" && b) {
            b.jsonBuf += evt.delta.partial_json;
          }
        } else if (evt.type === "message_delta") {
          if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
        }
      }
    }
  } catch (err) {
    if (!isAbortError(err)) throw err;
    aborted = true;
  }

  const toolCalls: ToolCall[] = aborted
    ? []
    : [...blocks.values()].filter((b) => b.type === "tool_use").map((b) => ({ id: b.id!, name: b.name!, arguments: b.jsonBuf || "{}" }));

  return { content, toolCalls, finishReason: aborted ? "aborted" : stopReason, aborted };
}

// ---- OpenAI /v1/chat/completions support ----

/** Non-streaming call, used for one-shot requests like the vision tool. */
export async function chatCompletion(
  endpoint: EndpointConfig,
  messages: Message[],
  options: CompletionOptions = {},
): Promise<CompletionResult> {
  if (endpoint.protocol === "anthropic") return anthropicChatCompletion(endpoint, messages, options);

  const res = await fetch(`${endpoint.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: endpoint.model,
      messages: toOpenAiMessages(messages),
      tools: toOpenAiTools(options.tools),
      stream: false,
    }),
    signal: options.signal,
  });
  if (!res.ok) {
    throw new Error(`LLM request failed: ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  const data: any = await res.json();
  const choice = data.choices[0];
  const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc: any) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: tc.function.arguments,
  }));
  return {
    content: choice.message.content ?? "",
    toolCalls,
    finishReason: choice.finish_reason,
  };
}

/** Streaming call over SSE, used for the main agent turn loop. */
export async function chatCompletionStream(
  endpoint: EndpointConfig,
  messages: Message[],
  options: CompletionOptions = {},
): Promise<CompletionResult> {
  if (endpoint.protocol === "anthropic") return anthropicChatCompletionStream(endpoint, messages, options);

  const res = await fetch(`${endpoint.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: endpoint.model,
      messages: toOpenAiMessages(messages),
      tools: toOpenAiTools(options.tools),
      stream: true,
    }),
    signal: options.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`LLM request failed: ${res.status} ${res.statusText}: ${await res.text()}`);
  }

  let content = "";
  const toolCallsByIndex = new Map<number, { id: string; name: string; arguments: string }>();
  let finishReason = "stop";

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let aborted = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;

        const chunk = JSON.parse(payload);
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          content += delta.content;
          options.onTextDelta?.(delta.content);
        }
        if (delta.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const idx = tcDelta.index ?? 0;
            const existing = toolCallsByIndex.get(idx) ?? { id: "", name: "", arguments: "" };
            if (tcDelta.id) existing.id = tcDelta.id;
            if (tcDelta.function?.name) existing.name = tcDelta.function.name;
            if (tcDelta.function?.arguments) existing.arguments += tcDelta.function.arguments;
            toolCallsByIndex.set(idx, existing);
          }
        }
        if (chunk.choices?.[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }
      }
    }
  } catch (err) {
    if (!isAbortError(err)) throw err;
    aborted = true;
  }

  // A tool call still being assembled when the abort hit is incomplete by
  // definition (partial JSON arguments) — dropped rather than run
  // half-specified. The text that already streamed in is kept either way.
  const toolCalls = aborted
    ? []
    : [...toolCallsByIndex.values()].map((tc, i) => ({
        id: tc.id || `call_${i}`,
        name: tc.name,
        arguments: tc.arguments,
      }));

  return { content, toolCalls, finishReason: aborted ? "aborted" : finishReason, aborted };
}
