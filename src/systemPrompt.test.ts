import { describe, it, expect, vi, afterEach } from "vitest";
import { tmpdir } from "node:os";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("baseSystemPrompt", () => {
  it("has no Python-specific instruction when PYTHON_PATH is unset", async () => {
    vi.stubEnv("PYTHON_PATH", "");
    vi.resetModules();
    const { initConfig } = await import("./config.js");
    initConfig();
    const { baseSystemPrompt } = await import("./systemPrompt.js");
    expect(baseSystemPrompt()).not.toContain("python");
  });

  it("embeds the literal PYTHON_PATH value when set", async () => {
    vi.stubEnv("PYTHON_PATH", "/opt/my-venv/bin/python");
    vi.resetModules();
    const { initConfig } = await import("./config.js");
    initConfig();
    const { baseSystemPrompt } = await import("./systemPrompt.js");
    const prompt = baseSystemPrompt();
    expect(prompt).toContain("/opt/my-venv/bin/python");
    expect(prompt).toContain("system Python");
  });

  it("always embeds the OS-correct temp dir and warns against hardcoding /tmp", async () => {
    vi.resetModules();
    const { baseSystemPrompt } = await import("./systemPrompt.js");
    const prompt = baseSystemPrompt();
    expect(prompt).toContain(tmpdir());
    expect(prompt).toContain('do not hardcode "/tmp"');
  });

  it("states the real configured model name and denies being Claude/Anthropic", async () => {
    vi.stubEnv("LLM_MODEL", "deepseek-v4-flash");
    vi.resetModules();
    const { initConfig } = await import("./config.js");
    initConfig();
    const { baseSystemPrompt } = await import("./systemPrompt.js");
    const prompt = baseSystemPrompt();
    expect(prompt).toContain('"deepseek-v4-flash"');
    expect(prompt).toContain("not Claude");
    expect(prompt).toContain("not made by Anthropic");
  });
});
