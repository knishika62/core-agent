import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadProjectInstructions, buildSystemPrompt } from "./projectInstructions.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "my-agent-proj-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadProjectInstructions", () => {
  it("returns null when no instructions file exists", async () => {
    expect(await loadProjectInstructions(dir)).toBeNull();
  });

  it("loads AGENT.md when present", async () => {
    await writeFile(path.join(dir, "AGENT.md"), "Use tabs, not spaces.");
    expect(await loadProjectInstructions(dir)).toBe("Use tabs, not spaces.");
  });

  it("ignores a whitespace-only file", async () => {
    await writeFile(path.join(dir, "AGENT.md"), "   \n  ");
    expect(await loadProjectInstructions(dir)).toBeNull();
  });
});

describe("buildSystemPrompt", () => {
  it("appends project instructions under a heading", () => {
    const result = buildSystemPrompt("base prompt", "custom rule");
    expect(result).toContain("base prompt");
    expect(result).toContain("# Project instructions");
    expect(result).toContain("custom rule");
  });

  it("returns the base prompt unchanged when there are no instructions", () => {
    expect(buildSystemPrompt("base prompt", null)).toBe("base prompt");
  });
});
