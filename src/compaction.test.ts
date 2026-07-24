import { describe, it, expect, vi, afterEach } from "vitest";
import { findSafeCutIndex, maybeCompact } from "./compaction.js";
import type { Message } from "./types.js";

describe("findSafeCutIndex", () => {
  it("never cuts before index 1 (keeps the system prompt)", () => {
    const messages: Message[] = [{ role: "system", content: "sys" }];
    expect(findSafeCutIndex(messages, 10)).toBe(1);
  });

  it("advances forward to the next user message to avoid splitting tool_calls/tool pairs", () => {
    const messages: Message[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "", toolCalls: [{ id: "1", name: "read", arguments: "{}" }] },
      { role: "tool", content: "result", toolCallId: "1", name: "read" },
      { role: "assistant", content: "done" },
      { role: "user", content: "u2" },
    ];
    // minKeep=1 would naively land on index 5 (the last message), which is
    // already "user" — but minKeep=3 lands mid-tool-exchange (index 3) and
    // must walk forward to the next real user message (index 5).
    expect(findSafeCutIndex(messages, 3)).toBe(5);
  });
});

describe("maybeCompact", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("does nothing when under the token budget", async () => {
    const messages: Message[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ];
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const compacted = await maybeCompact(messages);
    expect(compacted).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("summarizes older history once over budget, keeping system + recent window", async () => {
    vi.stubEnv("MAX_CONTEXT_TOKENS", "10");
    // re-import config with the stubbed env by dynamic import after stubbing
    vi.resetModules();
    const { initConfig } = await import("./config.js");
    initConfig();
    const { maybeCompact: maybeCompactFresh } = await import("./compaction.js");

    const messages: Message[] = [{ role: "system", content: "sys" }];
    for (let i = 0; i < 20; i++) {
      messages.push({ role: "user", content: `question ${i}` });
      messages.push({ role: "assistant", content: `answer ${i}` });
    }

    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "SUMMARY" }, finish_reason: "stop" }],
        }),
        { status: 200 },
      ),
    ) as any;

    const before = messages.length;
    const changed = await maybeCompactFresh(messages);
    expect(changed).toBe(true);
    expect(messages.length).toBeLessThan(before);
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toContain("SUMMARY");
    // the tail should still be present verbatim
    expect(messages[messages.length - 1].content).toBe("answer 19");
  });
});
