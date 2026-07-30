import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { capToolResult, executeToolCall } from "./index.js";
import { ToolContext } from "./context.js";

describe("capToolResult", () => {
  it("leaves a normal-sized result untouched", () => {
    const result = capToolResult("read", { content: "hello" });
    expect(result).toEqual({ content: "hello" });
  });

  it("truncates an oversized result and appends a notice, preserving isError", () => {
    const huge = "x".repeat(250_000);
    const result = capToolResult("search", { content: huge, isError: true });
    expect(result.content.length).toBeLessThan(huge.length);
    expect(result.content).toContain("output truncated");
    expect(result.content).toContain("search");
    expect(result.isError).toBe(true);
  });
});

describe("executeToolCall", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "core-agent-toolcap-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("caps an oversized result before it reaches the model, regardless of which tool produced it", async () => {
    // A big file with one enormous line, read raw — mirrors the real
    // incident's shape (search matching inside a minified bundle's single
    // huge line) without needing node_modules/a real bundle to reproduce.
    await writeFile(path.join(dir, "huge.txt"), "x".repeat(250_000));
    const ctx = new ToolContext(dir);
    const res = await executeToolCall(
      { id: "1", name: "read", arguments: JSON.stringify({ path: "huge.txt", whole: true, raw: true }) },
      ctx,
    );
    expect(res.content.length).toBeLessThan(250_000);
    expect(res.content).toContain("output truncated");
  });

  it("picks up a skill.json written after startup, without needing a restart", async () => {
    // Regression coverage for the gap where a skill authored mid-session
    // (e.g. by the model itself via `write`) was invisible until the whole
    // process restarted — executeToolCall() now re-scans skills on an
    // unknown-tool miss instead of only trusting the process-startup scan.
    const globalDir = await mkdtemp(path.join(tmpdir(), "core-agent-toolcap-global-"));
    vi.stubEnv("CORE_AGENT_HOME", globalDir);
    try {
      const skillDir = path.join(dir, "skills", "late_arrival");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "skill.json"),
        JSON.stringify({
          name: "late_arrival",
          tools: [
            {
              name: "skill_late_tool",
              description: "registered after the process already started",
              parameters: { type: "object", properties: {} },
              command: "node script.js",
            },
          ],
        }),
      );
      await writeFile(path.join(skillDir, "script.js"), `process.stdout.write("hi from late skill")`);

      const ctx = new ToolContext(dir);
      const result = await executeToolCall({ id: "1", name: "skill_late_tool", arguments: "{}" }, ctx);
      expect(result.isError).toBeUndefined();
      expect(result.content).toBe("hi from late skill");
    } finally {
      vi.unstubAllEnvs();
      await rm(globalDir, { recursive: true, force: true });
    }
  });
});
