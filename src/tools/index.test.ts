import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
});
