import { describe, it, expect, vi, afterEach } from "vitest";
import { chatCompletionStream, chatCompletion } from "./llmClient.js";
import type { Message } from "./types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function sseResponse(events: (unknown | "[DONE]")[]): Response {
  const body =
    events.map((e) => `data: ${e === "[DONE]" ? "[DONE]" : JSON.stringify(e)}\n`).join("\n") + "\n";
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("chatCompletionStream (OpenAI protocol)", () => {
  it("accumulates text deltas and tool_calls from SSE chunks", async () => {
    let onDeltaCalls: string[] = [];
    globalThis.fetch = vi.fn(async () =>
      sseResponse([
        { choices: [{ delta: { content: "Hel" } }] },
        { choices: [{ delta: { content: "lo" } }] },
        {
          choices: [
            { delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "list", arguments: "" } }] } },
          ],
        },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"."}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        "[DONE]",
      ]),
    ) as any;

    const result = await chatCompletionStream(
      { baseUrl: "https://api.openai.example/v1", apiKey: "k", model: "m" },
      [{ role: "user", content: "hi" }],
      { onTextDelta: (t) => onDeltaCalls.push(t) },
    );

    expect(onDeltaCalls).toEqual(["Hel", "lo"]);
    expect(result.content).toBe("Hello");
    expect(result.toolCalls).toEqual([{ id: "call_1", name: "list", arguments: '{"path":"."}' }]);
    expect(result.finishReason).toBe("tool_calls");
  });
});

describe("chatCompletionStream (Anthropic protocol)", () => {
  it("converts messages, parses SSE events, and extracts tool_use", async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      capturedBody = JSON.parse(init.body);
      return sseResponse([
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "call_1", name: "list" },
        },
        { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"path":' } },
        { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"."}' } },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "tool_use" } },
        { type: "message_stop" },
      ]);
    }) as any;

    const messages: Message[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "list files" },
    ];

    const result = await chatCompletionStream(
      { baseUrl: "https://api.anthropic.example/v1", apiKey: "test-key", model: "claude-x", protocol: "anthropic" },
      messages,
    );

    expect(capturedBody.system).toBe("You are helpful.");
    expect(capturedBody.messages).toEqual([{ role: "user", content: "list files" }]);
    expect(result.content).toBe("Hello world");
    expect(result.toolCalls).toEqual([{ id: "call_1", name: "list", arguments: '{"path":"."}' }]);
    expect(result.finishReason).toBe("tool_use");
  });

  it("folds consecutive tool-result messages into a single user message", async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      capturedBody = JSON.parse(init.body);
      return sseResponse([{ type: "message_stop" }]);
    }) as any;

    const messages: Message[] = [
      { role: "system", content: "sys" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "a", name: "read", arguments: "{}" },
          { id: "b", name: "list", arguments: "{}" },
        ],
      },
      { role: "tool", content: "read result", toolCallId: "a", name: "read" },
      { role: "tool", content: "list result", toolCallId: "b", name: "list" },
    ];

    await chatCompletionStream(
      { baseUrl: "https://api.anthropic.example/v1", apiKey: "k", model: "m", protocol: "anthropic" },
      messages,
    );

    expect(capturedBody.messages).toEqual([
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "a", name: "read", input: {} },
          { type: "tool_use", id: "b", name: "list", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "a", content: "read result" },
          { type: "tool_result", tool_use_id: "b", content: "list result" },
        ],
      },
    ]);
  });

  it("non-streaming chatCompletion extracts text and tool_use blocks", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [
              { type: "text", text: "hi there" },
              { type: "tool_use", id: "c1", name: "bash", input: { command: "ls" } },
            ],
            stop_reason: "tool_use",
          }),
          { status: 200 },
        ),
    ) as any;

    const result = await chatCompletion(
      { baseUrl: "https://api.anthropic.example/v1", apiKey: "k", model: "m", protocol: "anthropic" },
      [{ role: "user", content: "hi" }],
    );

    expect(result.content).toBe("hi there");
    expect(result.toolCalls).toEqual([{ id: "c1", name: "bash", arguments: '{"command":"ls"}' }]);
  });
});
