import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// readSync(0, ...) would otherwise block on this process's real stdin
// (indefinitely, in a non-interactive test runner) — mocked out so the
// first-run bootstrap path can be exercised without hanging the suite.
// existsSync/mkdirSync/writeFileSync stay real (importOriginal) so the rest
// of envLoader's file-system behavior is tested for real, not mocked away.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readSync: vi.fn(() => 1) };
});

// The real `python3 -m venv` is slow and depends on the test machine having
// Python installed at all — mocked so venv auto-setup is deterministic and
// each test controls whether it "succeeds" or "fails" via mockImplementation.
const execSyncMock = vi.fn();
vi.mock("node:child_process", () => ({ execSync: (...args: unknown[]) => execSyncMock(...args) }));

let dir: string;
let globalDir: string;
let originalBaseUrl: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "core-agent-envloader-"));
  globalDir = await mkdtemp(path.join(tmpdir(), "core-agent-envloader-global-"));
  vi.stubEnv("CORE_AGENT_HOME", globalDir);
  // dotenv only sets a key if it's *not already present* on process.env, so
  // this needs to be actually deleted (not just stubbed to "") for the
  // assertions below to observe the .env file's value taking effect.
  originalBaseUrl = process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_BASE_URL;
  // Default: every python candidate "fails" (simulates no system Python) —
  // individual tests override this to simulate a successful venv creation.
  execSyncMock.mockReset();
  execSyncMock.mockImplementation(() => {
    throw new Error("python: command not found");
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (originalBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
  else process.env.OPENAI_BASE_URL = originalBaseUrl;
  await rm(dir, { recursive: true, force: true });
  await rm(globalDir, { recursive: true, force: true });
});

describe("loadEnvFile", () => {
  it("prefers a cwd-local .env over the global one", async () => {
    await writeFile(path.join(dir, ".env"), "OPENAI_BASE_URL=http://local:1234/v1\n");
    await writeFile(path.join(globalDir, ".env"), "OPENAI_BASE_URL=http://global:1234/v1\n");

    const { loadEnvFile } = await import("./envLoader.js");
    loadEnvFile(dir);
    expect(process.env.OPENAI_BASE_URL).toBe("http://local:1234/v1");
  });

  it("falls back to the global .env when cwd has none", async () => {
    await writeFile(path.join(globalDir, ".env"), "OPENAI_BASE_URL=http://global:1234/v1\n");

    const { loadEnvFile } = await import("./envLoader.js");
    loadEnvFile(dir);
    expect(process.env.OPENAI_BASE_URL).toBe("http://global:1234/v1");
  });

  it("exits without writing anything when no Python interpreter is found", async () => {
    // default beforeEach mock: every `<python> --version` candidate throws.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { loadEnvFile } = await import("./envLoader.js");
    expect(() => loadEnvFile(dir)).toThrow("process.exit(0)");

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(existsSync(path.join(globalDir, ".env"))).toBe(false);
    expect(logSpy.mock.calls.join("\n")).toContain("No Python interpreter found");
  });

  it("bootstraps a starter global .env (with a venv-backed PYTHON_PATH) once Python is found", async () => {
    const venvDir = path.join(globalDir, "venv");
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes("--version")) return "";
      // Simulates `python -m venv <dir>`: create the interpreter file the
      // real command would have produced, so trySetupVenv's existsSync
      // check finds it.
      const interpreter =
        process.platform === "win32" ? path.join(venvDir, "Scripts", "python.exe") : path.join(venvDir, "bin", "python");
      mkdirSync(path.dirname(interpreter), { recursive: true });
      writeFileSync(interpreter, "");
      return "";
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { loadEnvFile } = await import("./envLoader.js");
    expect(() => loadEnvFile(dir)).toThrow("process.exit(0)");

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(existsSync(path.join(globalDir, ".env"))).toBe(true);
    const written = await readFile(path.join(globalDir, ".env"), "utf-8");
    expect(written).toContain("OPENAI_BASE_URL=");
    expect(written).toContain("EMAIL_SMTP_SERVER=");
    expect(written).toMatch(/^PYTHON_PATH=.*venv/m);
    expect(written).not.toContain("# PYTHON_PATH=");
    expect(logSpy.mock.calls.join("\n")).toContain(path.join(globalDir, ".env"));
    expect(logSpy.mock.calls.join("\n")).toContain("dedicated Python venv");
    expect(logSpy.mock.calls.join("\n")).toContain("skills");
  });
});
