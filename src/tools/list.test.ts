import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { toolList } from "./list.js";
import { ToolContext } from "./context.js";

let dir: string;
let ctx: ToolContext;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "core-agent-list-"));
  ctx = new ToolContext(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("toolList", () => {
  it("lists files and directories with type markers", async () => {
    await writeFile(path.join(dir, "a.txt"), "hi");
    await mkdir(path.join(dir, "sub"));
    const res = await toolList({ path: "." }, ctx);
    expect(res.content).toMatch(/^-.*a\.txt$/m);
    expect(res.content).toMatch(/^d.*sub\/$/m);
  });

  it("defaults to the current directory when path is omitted", async () => {
    await writeFile(path.join(dir, "a.txt"), "hi");
    const res = await toolList({}, ctx);
    expect(res.content).toMatch(/a\.txt/);
  });

  it("errors on a nonexistent directory", async () => {
    const res = await toolList({ path: "does-not-exist" }, ctx);
    expect(res.isError).toBe(true);
  });
});
