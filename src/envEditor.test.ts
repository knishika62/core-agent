import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { envEditorPaths, ensureEnvFile, pickEditorCommand } from "./envEditor.js";

let dir: string;
let globalDir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "core-agent-envedit-"));
  // Isolates globalConfigDir() from the real ~/.core-agent, same as hooks.test.ts.
  globalDir = await mkdtemp(path.join(tmpdir(), "core-agent-envedit-global-"));
  vi.stubEnv("CORE_AGENT_HOME", globalDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
  await rm(globalDir, { recursive: true, force: true });
});

describe("envEditorPaths", () => {
  it("resolves global to CORE_AGENT_HOME/.env and local to cwd/.env", () => {
    const paths = envEditorPaths(dir);
    expect(paths.global).toBe(path.join(globalDir, ".env"));
    expect(paths.local).toBe(path.join(dir, ".env"));
  });
});

describe("ensureEnvFile", () => {
  it("creates the file (and parent dir) from the template when missing, and returns true", async () => {
    const target = path.join(dir, "nested", ".env");
    const created = ensureEnvFile(target);
    expect(created).toBe(true);
    expect(existsSync(target)).toBe(true);
    const content = await readFile(target, "utf-8");
    expect(content).toContain("OPENAI_BASE_URL=");
  });

  it("leaves an existing file untouched and returns false", async () => {
    const target = path.join(dir, ".env");
    ensureEnvFile(target);
    await writeFile(target, "MY_CUSTOM_VALUE=1", "utf-8");
    const created = ensureEnvFile(target);
    expect(created).toBe(false);
    const content = await readFile(target, "utf-8");
    expect(content).toBe("MY_CUSTOM_VALUE=1");
  });
});

describe("pickEditorCommand", () => {
  it("prefers $EDITOR", () => {
    vi.stubEnv("EDITOR", "my-editor");
    vi.stubEnv("VISUAL", "my-visual");
    expect(pickEditorCommand()).toBe("my-editor");
  });

  it("falls back to $VISUAL when $EDITOR is unset", () => {
    vi.stubEnv("EDITOR", "");
    vi.stubEnv("VISUAL", "my-visual");
    expect(pickEditorCommand()).toBe("my-visual");
  });

  it("falls back to a platform default when neither is set", () => {
    vi.stubEnv("EDITOR", "");
    vi.stubEnv("VISUAL", "");
    const editor = pickEditorCommand();
    expect(editor).toBe(process.platform === "win32" ? "notepad" : "vi");
  });
});
