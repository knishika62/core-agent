import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { toolWrite } from "./write.js";
import { ToolContext } from "./context.js";

let dir: string;
let ctx: ToolContext;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "my-agent-write-"));
  ctx = new ToolContext(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("toolWrite", () => {
  it("creates a new file", async () => {
    const res = await toolWrite({ path: "f.txt", content: "hello" }, ctx);
    expect(res.isError).toBeUndefined();
    expect(await readFile(path.join(dir, "f.txt"), "utf-8")).toBe("hello");
  });

  it("overwrites an existing file unconditionally", async () => {
    await writeFile(path.join(dir, "f.txt"), "old");
    const res = await toolWrite({ path: "f.txt", content: "new" }, ctx);
    expect(res.isError).toBeUndefined();
    expect(await readFile(path.join(dir, "f.txt"), "utf-8")).toBe("new");
  });

  it("errors when path or content is missing", async () => {
    expect((await toolWrite({ content: "x" }, ctx)).isError).toBe(true);
    expect((await toolWrite({ path: "f.txt" }, ctx)).isError).toBe(true);
  });

  it("respects ctx.confirm and can be declined", async () => {
    ctx.confirm = async () => false;
    const res = await toolWrite({ path: "f.txt", content: "hello" }, ctx);
    expect(res.isError).toBe(true);
    await expect(readFile(path.join(dir, "f.txt"), "utf-8")).rejects.toThrow();
  });

  it("proceeds when ctx.confirm approves", async () => {
    ctx.confirm = async () => true;
    const res = await toolWrite({ path: "f.txt", content: "hello" }, ctx);
    expect(res.isError).toBeUndefined();
    expect(await readFile(path.join(dir, "f.txt"), "utf-8")).toBe("hello");
  });
});
