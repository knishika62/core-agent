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
