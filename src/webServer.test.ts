import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { startWebServer } from "./webServer.js";
import { config } from "./config.js";

// Mirrors llmClient.test.ts's SSE fixture helper.
function sseResponse(events: (unknown | "[DONE]")[]): Response {
  const body = events.map((e) => `data: ${e === "[DONE]" ? "[DONE]" : JSON.stringify(e)}\n`).join("\n") + "\n";
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function textReply(text: string): Response {
  return sseResponse([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }, "[DONE]"]);
}

function writeToolCallReply(filePath: string, content: string): Response {
  return sseResponse([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "write", arguments: "" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ path: filePath, content }) } }] } }] },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    "[DONE]",
  ]);
}

function toolCallReply(name: string, args: Record<string, unknown>): Response {
  return sseResponse([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name, arguments: "" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] } }] },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    "[DONE]",
  ]);
}

// Both the mocked LLM endpoint and the local test webServer are hit via the
// same global fetch, so the mock has to route by URL: LLM-bound calls get
// the canned response, everything else (calls into our own server) passes
// through to the real fetch. Captured once, before any test stubs it.
const realFetch = globalThis.fetch;
function mockLLM(handler: () => Response | Promise<Response>): void {
  globalThis.fetch = vi.fn(async (url: any, init?: any) => {
    if (String(url).startsWith(config.main.baseUrl)) return handler();
    return realFetch(url, init);
  }) as any;
}

async function* ndjsonEvents(res: Response): AsyncGenerator<any> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim()) yield JSON.parse(line);
    }
  }
  if (buf.trim()) yield JSON.parse(buf);
}

let cwd: string;
let globalDir: string;
let server: Server;
let base: string;
const SESSIONS_DIR = path.join(process.cwd(), "sessions");

beforeEach(async () => {
  // realpath: on macOS, os.tmpdir() returns a /var/... path that's actually
  // a symlink to /private/var/... — a shell's own `pwd` reports the
  // resolved form, so comparisons below need the same resolution or they'll
  // mismatch on a symlink difference that has nothing to do with the code
  // under test.
  cwd = await realpath(await mkdtemp(path.join(tmpdir(), "core-agent-webserver-")));
  // Isolates loadSkills/loadHooksConfig/scheduleCronJobs from the real
  // ~/.core-agent (same pattern as hooks.test.ts/skills.test.ts) — without
  // this, the real cron.json on this machine would get scheduled into the
  // test process.
  globalDir = await mkdtemp(path.join(tmpdir(), "core-agent-webserver-global-"));
  vi.stubEnv("CORE_AGENT_HOME", globalDir);

  config.main = { baseUrl: "https://api.example/v1", apiKey: "k", model: "test-model", protocol: "openai" };
  config.maxToolRounds = 50;

  server = await startWebServer({ cwd, host: "127.0.0.1", port: 0 });
  const addr = server.address();
  const port = addr && typeof addr === "object" ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(cwd, { recursive: true, force: true });
  await rm(globalDir, { recursive: true, force: true });
  await rm(SESSIONS_DIR, { recursive: true, force: true });
});

describe("GET /api/status and /api/sessions", () => {
  it("reports boot info and an empty session list", async () => {
    const status = await (await fetch(`${base}/api/status`)).json();
    expect(status.model).toBe("test-model");
    expect(status.baseUrl).toBe("https://api.example/v1");
    expect(status.hookCount).toBe(0);
    expect(status.cronScheduled).toBe(0);
    expect(Array.isArray(status.tools)).toBe(true);
    expect(status.tools.some((t: any) => t.name === "write")).toBe(true);

    const sessions = await (await fetch(`${base}/api/sessions`)).json();
    expect(sessions).toEqual([]);
  });
});

describe("POST /api/session/:name/message", () => {
  it("streams text_delta events for a plain-text reply", async () => {
    mockLLM(() => textReply("hello there"));

    const res = await fetch(`${base}/api/session/plain-test/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hi" }),
    });
    expect(res.ok).toBe(true);

    const events: any[] = [];
    for await (const evt of ndjsonEvents(res)) events.push(evt);

    expect(events.map((e) => e.type)).toContain("text_delta");
    expect(events.map((e) => e.text).join("")).toBe("hello there");
    expect(events.at(-1).type).toBe("done");
  });

  it("gates write behind confirm_request, resolved via /api/confirm/:id", async () => {
    let callCount = 0;
    mockLLM(() => {
      callCount++;
      return callCount === 1 ? writeToolCallReply("out.txt", "hello") : textReply("done");
    });

    const res = await fetch(`${base}/api/session/confirm-test/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "write a file" }),
    });
    expect(res.ok).toBe(true);

    const events: any[] = [];
    let confirmId: string | undefined;
    for await (const evt of ndjsonEvents(res)) {
      events.push(evt);
      if (evt.type === "confirm_request") {
        confirmId = evt.id;
        await fetch(`${base}/api/confirm/${confirmId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ approved: true }),
        });
      }
    }

    expect(confirmId).toBeDefined();
    expect(events.some((e) => e.type === "tool_result" && e.name === "write")).toBe(true);
    expect(await readFile(path.join(cwd, "out.txt"), "utf-8")).toBe("hello");
  });

  it("skips confirmation once auto mode is enabled", async () => {
    await fetch(`${base}/api/session/auto-test/auto`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });

    let callCount = 0;
    mockLLM(() => {
      callCount++;
      return callCount === 1 ? writeToolCallReply("auto-out.txt", "auto-written") : textReply("done");
    });

    const res = await fetch(`${base}/api/session/auto-test/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "write a file" }),
    });

    const events: any[] = [];
    for await (const evt of ndjsonEvents(res)) events.push(evt);

    expect(events.some((e) => e.type === "confirm_request")).toBe(false);
    expect(await readFile(path.join(cwd, "auto-out.txt"), "utf-8")).toBe("auto-written");
  });
});

describe("POST /api/session/:name/reset", () => {
  it("clears the conversation back to just the system prompt", async () => {
    mockLLM(() => textReply("hi"));
    const msgRes = await fetch(`${base}/api/session/reset-test/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });
    for await (const _ of ndjsonEvents(msgRes)) {
      // drain
    }

    let session = await (await fetch(`${base}/api/session/reset-test`)).json();
    expect(session.messages.length).toBeGreaterThan(1);

    await fetch(`${base}/api/session/reset-test/reset`, { method: "POST" });
    session = await (await fetch(`${base}/api/session/reset-test`)).json();
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].role).toBe("system");
  });
});

describe("POST /api/session/:name/shell", () => {
  it("runs a plain command in the session's cwd, bypassing the model", async () => {
    const res = await fetch(`${base}/api/session/shell-test/shell`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "pwd" }),
    });
    const data = await res.json();
    expect(data.exitCode).toBe(0);
    expect(data.output.trim()).toBe(cwd);
  });

  it("special-cases cd to update only this session's cwd", async () => {
    const sub = path.join(cwd, "subdir");
    await mkdir(sub);

    const cdRes = await fetch(`${base}/api/session/shell-cd-test/shell`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "cd subdir" }),
    });
    const cdData = await cdRes.json();
    expect(cdData.exitCode).toBe(0);
    expect(cdData.cwd).toBe(sub);

    const pwdRes = await fetch(`${base}/api/session/shell-cd-test/shell`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "pwd" }),
    });
    const pwdData = await pwdRes.json();
    expect(pwdData.output.trim()).toBe(sub);

    // A different session is unaffected — cd is scoped per-session, not global.
    const otherRes = await fetch(`${base}/api/session/shell-test/shell`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "pwd" }),
    });
    const otherData = await otherRes.json();
    expect(otherData.output.trim()).toBe(cwd);
  });

  it("reports a non-zero exit code and captured stderr on failure", async () => {
    const res = await fetch(`${base}/api/session/shell-fail-test/shell`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "exit 3" }),
    });
    const data = await res.json();
    expect(data.exitCode).toBe(3);
  });
});

describe("GET /api/session/:name (history reload)", () => {
  it("enriches show_media tool_calls with a resolved mediaPath, same as the live stream", async () => {
    const filePath = path.join(cwd, "clip.mp4");
    await writeFile(filePath, "fake-video-bytes");

    let callCount = 0;
    mockLLM(() => {
      callCount++;
      return callCount === 1 ? toolCallReply("show_media", { path: "clip.mp4" }) : textReply("done");
    });
    const msgRes = await fetch(`${base}/api/session/media-history-test/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "show me the clip" }),
    });
    for await (const _ of ndjsonEvents(msgRes)) {
      // drain
    }

    // Simulates a page reload: fetch this session's history fresh, the way
    // switchSession() does, and confirm the tool_call still carries a
    // resolved mediaPath even though it's coming from persisted history
    // now, not the live event stream.
    const session = await (await fetch(`${base}/api/session/media-history-test`)).json();
    const assistantWithCall = session.messages.find((m: any) => m.toolCalls?.some((c: any) => c.name === "show_media"));
    expect(assistantWithCall).toBeDefined();
    const call = assistantWithCall.toolCalls.find((c: any) => c.name === "show_media");
    expect(call.mediaPath).toBe(filePath);
  });

  it("omits mediaPath (live and reloaded) when GUI_INLINE_MEDIA is disabled — /api/media 404s regardless, so sending it would just point the client at a broken tag", async () => {
    config.guiInlineMedia = false;
    const filePath = path.join(cwd, "clip2.mp4");
    await writeFile(filePath, "fake-video-bytes");

    let callCount = 0;
    mockLLM(() => {
      callCount++;
      return callCount === 1 ? toolCallReply("show_media", { path: "clip2.mp4" }) : textReply("done");
    });
    const msgRes = await fetch(`${base}/api/session/media-disabled-test/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "show me the clip" }),
    });
    const liveEvents: any[] = [];
    for await (const evt of ndjsonEvents(msgRes)) liveEvents.push(evt);
    const liveCall = liveEvents.find((e) => e.type === "tool_call" && e.name === "show_media");
    expect(liveCall.mediaPath).toBeUndefined();

    const session = await (await fetch(`${base}/api/session/media-disabled-test`)).json();
    const assistantWithCall = session.messages.find((m: any) => m.toolCalls?.some((c: any) => c.name === "show_media"));
    const call = assistantWithCall.toolCalls.find((c: any) => c.name === "show_media");
    expect(call.mediaPath).toBeUndefined();

    config.guiInlineMedia = true;
  });
});

describe("GET /api/media", () => {
  it("streams a file's bytes with the right content-type", async () => {
    const filePath = path.join(cwd, "photo.png");
    await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]));

    const res = await fetch(`${base}/api/media?path=${encodeURIComponent(filePath)}`);
    expect(res.ok).toBe(true);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes).toEqual(await readFile(filePath));
  });

  it("404s on a missing file", async () => {
    const res = await fetch(`${base}/api/media?path=${encodeURIComponent(path.join(cwd, "nope.png"))}`);
    expect(res.status).toBe(404);
  });

  it("400s when path is missing", async () => {
    const res = await fetch(`${base}/api/media`);
    expect(res.status).toBe(400);
  });

  it("is disabled by GUI_INLINE_MEDIA=0", async () => {
    // handleMedia reads config.guiInlineMedia fresh per request (same as
    // the rest of config.*), so flipping the shared config object is
    // enough — no server restart needed.
    config.guiInlineMedia = false;
    const filePath = path.join(cwd, "photo2.png");
    await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const res = await fetch(`${base}/api/media?path=${encodeURIComponent(filePath)}`);
    expect(res.status).toBe(404);
    config.guiInlineMedia = true;
  });
});
