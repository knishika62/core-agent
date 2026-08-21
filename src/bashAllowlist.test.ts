import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadBashAllowlist } from "./bashAllowlist.js";

let dir: string;
let globalDir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "core-agent-bashallow-"));
  globalDir = await mkdtemp(path.join(tmpdir(), "core-agent-bashallow-global-"));
  vi.stubEnv("CORE_AGENT_HOME", globalDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
  await rm(globalDir, { recursive: true, force: true });
});

describe("loadBashAllowlist", () => {
  it("returns [] when no config file exists anywhere", async () => {
    expect(await loadBashAllowlist(dir)).toEqual([]);
  });

  it("falls back to the global config dir when cwd has no bash-allowlist.json", async () => {
    await writeFile(path.join(globalDir, "bash-allowlist.json"), JSON.stringify(["ls", "cat"]));
    expect(await loadBashAllowlist(dir)).toEqual(["ls", "cat"]);
  });

  it("prefers a cwd-local bash-allowlist.json over the global one", async () => {
    await mkdir(path.join(dir, ".core-agent"), { recursive: true });
    await writeFile(path.join(dir, ".core-agent", "bash-allowlist.json"), JSON.stringify(["pwd"]));
    await writeFile(path.join(globalDir, "bash-allowlist.json"), JSON.stringify(["ls", "cat"]));
    expect(await loadBashAllowlist(dir)).toEqual(["pwd"]);
  });

  it("ignores non-string entries and returns [] for malformed JSON", async () => {
    await mkdir(path.join(dir, ".core-agent"), { recursive: true });
    await writeFile(path.join(dir, ".core-agent", "bash-allowlist.json"), JSON.stringify(["ls", 42, null, "cat"]));
    expect(await loadBashAllowlist(dir)).toEqual(["ls", "cat"]);
  });

  it("returns [] when the config file isn't a JSON array", async () => {
    await mkdir(path.join(dir, ".core-agent"), { recursive: true });
    await writeFile(path.join(dir, ".core-agent", "bash-allowlist.json"), JSON.stringify({ commands: ["ls"] }));
    expect(await loadBashAllowlist(dir)).toEqual([]);
  });
});
