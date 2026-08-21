import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { toolBash, toolBashStatus, toolBashStop } from "./bash.js";
import { ToolContext } from "./context.js";

let ctx: ToolContext;
let dir: string;
let globalDir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "core-agent-bash-"));
  // Isolates loadBashAllowlist's globalConfigDir() fallback from the real
  // ~/.core-agent (same rationale as hooks.test.ts/skills.test.ts).
  globalDir = await mkdtemp(path.join(tmpdir(), "core-agent-bash-global-"));
  vi.stubEnv("CORE_AGENT_HOME", globalDir);
  ctx = new ToolContext(dir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
  await rm(globalDir, { recursive: true, force: true });
});

describe("toolBash", () => {
  it("runs a quick command and returns its output", async () => {
    const res = await toolBash({ command: "echo hello", refresh_sec: 2 }, ctx);
    expect(res.content).toContain("status=done");
    expect(res.content).toContain("exit_status=0");
    expect(res.content).toContain("hello");
  });

  it("errors when command is missing", async () => {
    const res = await toolBash({}, ctx);
    expect(res.isError).toBe(true);
  });

  it("reports a job as still running when it outlives refresh_sec", async () => {
    const res = await toolBash({ command: "sleep 2 && echo done", refresh_sec: 1 }, ctx);
    expect(res.content).toContain("status=running");
    // clean up: let it finish and reap
    await new Promise((r) => setTimeout(r, 2200));
  }, 5000);

  it("bash_status finds a job by id and bash_stop terminates it", async () => {
    const started = await toolBash({ command: "sleep 30", refresh_sec: 1 }, ctx);
    const jobMatch = started.content.match(/job=(\d+)/);
    expect(jobMatch).not.toBeNull();
    const jobId = Number(jobMatch![1]);

    const status = await toolBashStatus({ job: jobId }, ctx);
    expect(status.content).toContain("status=running");

    const stopped = await toolBashStop({ job: jobId, refresh_sec: 1 }, ctx);
    expect(stopped.content).toContain("status=done");
  }, 10000);

  it("kills a job that exceeds timeout_sec", async () => {
    const res = await toolBash({ command: "sleep 5", timeout_sec: 1, refresh_sec: 2 }, ctx);
    expect(res.content).toContain("timed_out=true");
  }, 5000);

  it("errors when the job is not found", async () => {
    const res = await toolBashStatus({ job: 99999 }, ctx);
    expect(res.isError).toBe(true);
  });

  it("respects ctx.confirm and can be declined", async () => {
    ctx.confirm = async () => false;
    const res = await toolBash({ command: "echo should-not-run" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/not approved/);
  });

  it("still requires confirmation for an allowlist-eligible command when no allowlist config exists", async () => {
    // No .core-agent/bash-allowlist.json anywhere — default is "no
    // allowlist", so even a program that could be safe (pwd) isn't
    // auto-approved until the user opts in via config.
    let called = false;
    ctx.confirm = async () => {
      called = true;
      return false;
    };
    const res = await toolBash({ command: "pwd" }, ctx);
    expect(called).toBe(true);
    expect(res.isError).toBe(true);
  });

  it("skips confirmation for a command listed in bash-allowlist.json", async () => {
    await mkdir(path.join(dir, ".core-agent"), { recursive: true });
    await writeFile(path.join(dir, ".core-agent", "bash-allowlist.json"), JSON.stringify(["pwd"]));

    let called = false;
    ctx.confirm = async () => {
      called = true;
      return true;
    };
    const res = await toolBash({ command: "pwd" }, ctx);
    expect(called).toBe(false);
    expect(res.content).toContain("status=done");
  });

  it("still requires confirmation for a command not in bash-allowlist.json", async () => {
    await mkdir(path.join(dir, ".core-agent"), { recursive: true });
    await writeFile(path.join(dir, ".core-agent", "bash-allowlist.json"), JSON.stringify(["pwd"]));

    let called = false;
    ctx.confirm = async () => {
      called = true;
      return false;
    };
    const res = await toolBash({ command: "echo should-not-run" }, ctx);
    expect(called).toBe(true);
    expect(res.isError).toBe(true);
  });
});
