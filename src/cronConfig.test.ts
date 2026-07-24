import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadCronConfig } from "./cronConfig.js";

let dir: string;
let globalDir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "core-agent-cron-"));
  // Isolates globalConfigDir() from the real ~/.core-agent (see the
  // identical comment in skills.test.ts).
  globalDir = await mkdtemp(path.join(tmpdir(), "core-agent-cron-global-"));
  vi.stubEnv("CORE_AGENT_HOME", globalDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
  await rm(globalDir, { recursive: true, force: true });
});

async function writeCronConfig(cwd: string, config: unknown) {
  await mkdir(path.join(cwd, ".core-agent"), { recursive: true });
  await writeFile(path.join(cwd, ".core-agent", "cron.json"), JSON.stringify(config));
}

describe("loadCronConfig", () => {
  it("returns an empty job list when no config file exists", async () => {
    expect(await loadCronConfig(dir)).toEqual({ jobs: [] });
  });

  it("parses valid jobs", async () => {
    await writeCronConfig(dir, { jobs: [{ name: "news", schedule: "0 18 * * *", prompt: "do the thing" }] });
    const config = await loadCronConfig(dir);
    expect(config.jobs).toEqual([{ name: "news", schedule: "0 18 * * *", prompt: "do the thing" }]);
  });

  it("preserves an explicit session name when given", async () => {
    await writeCronConfig(dir, {
      jobs: [{ name: "news", schedule: "0 18 * * *", prompt: "p", session: "custom-session" }],
    });
    const config = await loadCronConfig(dir);
    expect(config.jobs[0].session).toBe("custom-session");
  });

  it("filters out malformed job entries instead of throwing", async () => {
    await writeCronConfig(dir, {
      jobs: [{ name: "ok", schedule: "* * * * *", prompt: "p" }, { name: "missing-fields" }, "not an object", 42],
    });
    const config = await loadCronConfig(dir);
    expect(config.jobs).toEqual([{ name: "ok", schedule: "* * * * *", prompt: "p" }]);
  });

  it("returns an empty job list when the jobs field is missing or not an array", async () => {
    await writeCronConfig(dir, { notJobs: true });
    expect(await loadCronConfig(dir)).toEqual({ jobs: [] });
  });

  it("falls back to the global config dir when cwd has no cron.json", async () => {
    // globalConfigDir() *is* the ~/.core-agent-equivalent dir already, so
    // the global cron.json sits directly under it — unlike the cwd case,
    // no extra ".core-agent" segment.
    await writeFile(path.join(globalDir, "cron.json"), JSON.stringify({ jobs: [{ name: "global-job", schedule: "0 9 * * *", prompt: "p" }] }));
    const config = await loadCronConfig(dir);
    expect(config.jobs).toEqual([{ name: "global-job", schedule: "0 9 * * *", prompt: "p" }]);
  });

  it("prefers a cwd-local cron.json over the global one", async () => {
    await writeCronConfig(dir, { jobs: [{ name: "local-job", schedule: "0 9 * * *", prompt: "p" }] });
    await writeFile(path.join(globalDir, "cron.json"), JSON.stringify({ jobs: [{ name: "global-job", schedule: "0 9 * * *", prompt: "p" }] }));
    const config = await loadCronConfig(dir);
    expect(config.jobs).toEqual([{ name: "local-job", schedule: "0 9 * * *", prompt: "p" }]);
  });
});
