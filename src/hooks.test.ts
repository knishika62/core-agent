import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadHooksConfig, runPreToolUseHooks, runPostToolUseHooks } from "./hooks.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "core-agent-hooks-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeHooksConfig(cwd: string, config: unknown) {
  await mkdir(path.join(cwd, ".core-agent"), { recursive: true });
  await writeFile(path.join(cwd, ".core-agent", "hooks.json"), JSON.stringify(config));
}

describe("loadHooksConfig", () => {
  it("returns {} when no config file exists", async () => {
    expect(await loadHooksConfig(dir)).toEqual({});
  });
});

describe("runPreToolUseHooks", () => {
  it("does not block when no rule matches the tool name", async () => {
    await writeHooksConfig(dir, { preToolUse: [{ match: "bash", command: "exit 1" }] });
    const result = await runPreToolUseHooks(dir, "write", "{}");
    expect(result.blocked).toBe(false);
  });

  it("blocks the tool call when a matching pre-hook exits non-zero", async () => {
    await writeHooksConfig(dir, { preToolUse: [{ match: "write", command: "exit 1" }] });
    const result = await runPreToolUseHooks(dir, "write", "{}");
    expect(result.blocked).toBe(true);
  });

  it("allows the tool call when the matching pre-hook exits zero", async () => {
    await writeHooksConfig(dir, { preToolUse: [{ match: "write", command: "exit 0" }] });
    const result = await runPreToolUseHooks(dir, "write", "{}");
    expect(result.blocked).toBe(false);
  });

  it("treats a bare '*' (or omitted match) as matching every tool", async () => {
    await writeHooksConfig(dir, { preToolUse: [{ command: "exit 1" }] });
    expect((await runPreToolUseHooks(dir, "read", "{}")).blocked).toBe(true);
    expect((await runPreToolUseHooks(dir, "bash", "{}")).blocked).toBe(true);
  });

  it("passes the tool name and args to the hook via env vars", async () => {
    await writeHooksConfig(dir, {
      preToolUse: [{ match: "*", command: `node -e "console.error(process.env.CORE_AGENT_TOOL_NAME); process.exit(1)"` }],
    });
    const result = await runPreToolUseHooks(dir, "bash", '{"command":"ls"}');
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("bash");
  });
});

describe("runPostToolUseHooks", () => {
  it("does not throw even if the hook command fails", async () => {
    await writeHooksConfig(dir, { postToolUse: [{ match: "*", command: "exit 1" }] });
    await expect(runPostToolUseHooks(dir, "write", "{}", "result", false)).resolves.toBeUndefined();
  });

  it("resolves when there are no matching post-hooks", async () => {
    await writeHooksConfig(dir, { postToolUse: [{ match: "nonexistent_tool", command: "exit 1" }] });
    await expect(runPostToolUseHooks(dir, "write", "{}", "result", false)).resolves.toBeUndefined();
  });
});
