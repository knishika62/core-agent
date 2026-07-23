import { describe, it, expect, beforeEach } from "vitest";
import { toolBash, toolBashStatus, toolBashStop } from "./bash.js";
import { ToolContext } from "./context.js";

let ctx: ToolContext;

beforeEach(() => {
  ctx = new ToolContext(process.cwd());
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
});
