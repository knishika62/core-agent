import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { toolWrite } from "./write.js";
import { ToolContext } from "./context.js";

const OUTSIDE_PATH = "/definitely-outside-cwd-and-tmp/f.txt";

let dir: string;
let ctx: ToolContext;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "core-agent-write-"));
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

  it("respects ctx.confirm and can be declined (path outside cwd/tmp)", async () => {
    ctx.confirm = async () => false;
    const res = await toolWrite({ path: OUTSIDE_PATH, content: "hello" }, ctx);
    expect(res.isError).toBe(true);
  });

  it("proceeds when ctx.confirm approves (path outside cwd/tmp)", async () => {
    const confirmSpy = vi.fn(async () => true);
    ctx.confirm = confirmSpy;
    const res = await toolWrite({ path: OUTSIDE_PATH, content: "hello" }, ctx);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // The target dir doesn't exist on disk, so the actual write fails after
    // confirmation — that's fine, this test only asserts confirm was consulted.
    expect(res.isError).toBe(true);
  });

  it("auto-approves a write inside cwd without prompting", async () => {
    const confirmSpy = vi.fn(async () => false); // would deny if called
    ctx.confirm = confirmSpy;
    const res = await toolWrite({ path: "f.txt", content: "hello" }, ctx);
    expect(res.isError).toBeUndefined();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(await readFile(path.join(dir, "f.txt"), "utf-8")).toBe("hello");
  });

  it("auto-approves a write inside os.tmpdir() even when cwd is elsewhere", async () => {
    const confirmSpy = vi.fn(async () => false);
    const otherCtx = new ToolContext("/some/unrelated/cwd", confirmSpy);
    const target = path.join(dir, "in-tmp.txt");
    const res = await toolWrite({ path: target, content: "hello" }, otherCtx);
    expect(res.isError).toBeUndefined();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(await readFile(target, "utf-8")).toBe("hello");
  });

  it("still requires confirmation for a path outside cwd and tmpdir", async () => {
    const confirmSpy = vi.fn(async () => false);
    ctx.confirm = confirmSpy;
    const res = await toolWrite({ path: OUTSIDE_PATH, content: "hello" }, ctx);
    expect(res.isError).toBe(true);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });
});
