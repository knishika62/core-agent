import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { toolRead, toolMore } from "./read.js";
import { ToolContext } from "./context.js";

let dir: string;
let ctx: ToolContext;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "my-agent-read-"));
  ctx = new ToolContext(dir);
  const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
  await writeFile(path.join(dir, "f.txt"), lines, "utf-8");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("toolRead", () => {
  it("reads the whole file with line numbers", async () => {
    const res = await toolRead({ path: "f.txt", whole: true }, ctx);
    expect(res.content).toContain("lines 1-10 of 10");
    expect(res.content).toContain("1 line1");
    expect(res.content).toContain("10 line10");
  });

  it("truncates to max_lines and lets `more` continue", async () => {
    const first = await toolRead({ path: "f.txt", max_lines: 3 }, ctx);
    expect(first.content).toContain("lines 1-3 of 10");
    expect(first.content).toMatch(/continue_offset=4/);

    const rest = await toolMore({ count: 100 }, ctx);
    expect(rest.content).toContain("lines 4-10 of 10");
  });

  it("`more` without a prior read errors", async () => {
    const res = await toolMore({}, new ToolContext(dir));
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/no previous output/);
  });

  it("errors on a missing path argument", async () => {
    const res = await toolRead({}, ctx);
    expect(res.isError).toBe(true);
  });

  it("errors on a nonexistent file", async () => {
    const res = await toolRead({ path: "nope.txt" }, ctx);
    expect(res.isError).toBe(true);
  });

  it("raw mode omits line numbers and the header", async () => {
    const res = await toolRead({ path: "f.txt", whole: true, raw: true }, ctx);
    expect(res.content).not.toContain("lines 1-10");
    expect(res.content).not.toMatch(/^1 line1/m);
    expect(res.content).toContain("line1\n");
  });
});
