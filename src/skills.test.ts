import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSkills } from "./skills.js";
import { executeToolCall, toolDefinitions } from "./tools/index.js";
import { ToolContext } from "./tools/context.js";

let dir: string;
let globalDir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "core-agent-skills-"));
  // Points globalConfigDir() at a disposable temp dir instead of the real
  // ~/.core-agent, so these tests don't depend on (or pollute) whatever
  // happens to exist there on the machine running them.
  globalDir = await mkdtemp(path.join(tmpdir(), "core-agent-skills-global-"));
  vi.stubEnv("CORE_AGENT_HOME", globalDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
  await rm(globalDir, { recursive: true, force: true });
});

async function writeSkill(cwd: string, skillName: string, toolName: string, scriptBody: string) {
  const skillDir = path.join(cwd, "skills", skillName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "skill.json"),
    JSON.stringify({
      name: skillName,
      tools: [
        {
          name: toolName,
          description: "test tool",
          parameters: { type: "object", properties: { x: { type: "number" } } },
          command: "node script.js",
        },
      ],
    }),
  );
  await writeFile(path.join(skillDir, "script.js"), scriptBody);
}

describe("loadSkills", () => {
  it("returns [] when there is no skills/ directory", async () => {
    expect(await loadSkills(dir)).toEqual([]);
  });

  it("discovers a skill, registers its tool, and dispatches args via stdin", async () => {
    await writeSkill(
      dir,
      "echoer_a",
      "skill_echo_a",
      `let data = "";
       process.stdin.on("data", (c) => (data += c));
       process.stdin.on("end", () => {
         const args = JSON.parse(data);
         process.stdout.write("got:" + args.x);
       });`,
    );

    const loaded = await loadSkills(dir);
    expect(loaded).toEqual(["echoer_a/skill_echo_a"]);
    expect(toolDefinitions.some((t) => t.name === "skill_echo_a")).toBe(true);

    const ctx = new ToolContext(dir);
    const result = await executeToolCall(
      { id: "1", name: "skill_echo_a", arguments: JSON.stringify({ x: 42 }) },
      ctx,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content).toBe("got:42");
  });

  it("skips registering a tool whose name collides with an existing one (e.g. a core tool)", async () => {
    await writeSkill(dir, "collider", "read", "process.stdout.write('should not register')");
    const loaded = await loadSkills(dir);
    expect(loaded).toEqual([]);
  });

  it("reports a skill script's failure as a tool error", async () => {
    await writeSkill(dir, "failer", "skill_fail", `process.stderr.write("boom"); process.exit(1);`);
    await loadSkills(dir);
    const ctx = new ToolContext(dir);
    const result = await executeToolCall({ id: "1", name: "skill_fail", arguments: "{}" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("boom");
  });

  it("respects ctx.confirm and can be declined", async () => {
    await writeSkill(dir, "echoer_b", "skill_echo_b", "process.stdout.write('should not run')");
    await loadSkills(dir);

    const ctx = new ToolContext(dir);
    ctx.confirm = async () => false;
    const result = await executeToolCall({ id: "1", name: "skill_echo_b", arguments: "{}" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/not approved/);
  });

  it("ignores directories under skills/ that have no skill.json", async () => {
    await mkdir(path.join(dir, "skills", "not_a_skill"), { recursive: true });
    expect(await loadSkills(dir)).toEqual([]);
  });

  it("also loads skills from the global config dir (~/.core-agent/skills) when cwd has none", async () => {
    await writeSkill(globalDir, "global_echoer", "skill_echo_global", "process.stdout.write('from global')");
    const loaded = await loadSkills(dir);
    expect(loaded).toEqual(["global_echoer/skill_echo_global"]);
  });

  it("honors a per-tool timeout_ms override instead of the 2-minute default", async () => {
    // Regression coverage: a skill whose own poll loop legitimately runs long
    // (e.g. ltx_video_faceid waiting on a slow GPU job) needs its execSync
    // wrapper to not kill it before that loop finishes. A short override here
    // proves the field is actually read, without a real test waiting on the
    // 2-minute default to confirm the *unbounded* case.
    const skillDir = path.join(dir, "skills", "slow_skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "skill.json"),
      JSON.stringify({
        name: "slow_skill",
        tools: [
          {
            name: "skill_slow",
            description: "test tool",
            parameters: { type: "object", properties: {} },
            command: "node script.js",
            timeout_ms: 100,
          },
        ],
      }),
    );
    await writeFile(
      path.join(skillDir, "script.js"),
      `setTimeout(() => process.stdout.write("done"), 1000);`,
    );

    await loadSkills(dir);
    const ctx = new ToolContext(dir);
    const result = await executeToolCall({ id: "1", name: "skill_slow", arguments: "{}" }, ctx);
    expect(result.isError).toBe(true);
  });

  it("re-scanning an already-loaded skill doesn't re-warn or re-register it", async () => {
    // Regression coverage: runTurn() re-scans skills every round so a skill
    // written mid-session is usable without a restart, which means an
    // already-loaded skill gets rediscovered on every round too — this must
    // stay a silent no-op (see [[#skill-hot-reload]] in CLAUDE.md), not spam
    // stderr with the "already exists" collision warning once per round.
    await writeSkill(dir, "repeat_scan", "skill_repeat", "process.stdout.write('ok')");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const first = await loadSkills(dir);
      expect(first).toEqual(["repeat_scan/skill_repeat"]);
      errorSpy.mockClear();

      for (let i = 0; i < 5; i++) {
        const again = await loadSkills(dir);
        expect(again).toEqual(["repeat_scan/skill_repeat"]);
      }
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("merges cwd and global skills, preferring the cwd one on a name collision", async () => {
    await writeSkill(dir, "local_pkg", "skill_shared", "process.stdout.write('local')");
    await writeSkill(globalDir, "global_pkg", "skill_shared", "process.stdout.write('global')");
    await writeSkill(globalDir, "global_only", "skill_only_global", "process.stdout.write('only global')");

    const loaded = await loadSkills(dir);
    // the cwd-scanned tool registers first, so the global one with the same
    // name is skipped by registerTool()'s existing collision guard.
    expect(loaded).toEqual(["local_pkg/skill_shared", "global_only/skill_only_global"]);

    const ctx = new ToolContext(dir);
    const result = await executeToolCall({ id: "1", name: "skill_shared", arguments: "{}" }, ctx);
    expect(result.content).toBe("local");
  });
});
