import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { toolEdit } from "./edit.js";
import { ToolContext } from "./context.js";

let dir: string;
let ctx: ToolContext;
// Neither inside `dir` (a tmpdir subdir) nor inside os.tmpdir() itself —
// process.cwd() here is the repo root, used purely as a real "outside" location.
let outsideDir: string;
let outsidePath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "core-agent-edit-"));
  ctx = new ToolContext(dir);
  outsideDir = path.join(process.cwd(), ".core-agent-edit-outside-test");
  await mkdir(outsideDir, { recursive: true });
  outsidePath = path.join(outsideDir, "f.txt");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
});

async function write(name: string, content: string) {
  await writeFile(path.join(dir, name), content, "utf-8");
}
async function read(name: string) {
  return readFile(path.join(dir, name), "utf-8");
}

describe("toolEdit", () => {
  it("replaces a unique match", async () => {
    await write("f.txt", "a\nb\nc\n");
    const res = await toolEdit({ path: "f.txt", old: "b", new: "BBB" }, ctx);
    expect(res.isError).toBeUndefined();
    expect(await read("f.txt")).toBe("a\nBBB\nc\n");
  });

  it("errors when old text is not found", async () => {
    await write("f.txt", "a\nb\nc\n");
    const res = await toolEdit({ path: "f.txt", old: "zzz", new: "x" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/anchor not found/);
  });

  it("errors when old text is not unique", async () => {
    await write("f.txt", "foo\nfoo\n");
    const res = await toolEdit({ path: "f.txt", old: "foo", new: "bar" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/not unique/);
  });

  it("supports [upto] head/tail anchoring", async () => {
    await write("f.txt", "start\nmiddle1\nmiddle2\nend\n");
    const res = await toolEdit({ path: "f.txt", old: "start[upto]end", new: "replaced" }, ctx);
    expect(res.isError).toBeUndefined();
    expect(await read("f.txt")).toBe("replaced\n");
  });

  it("scopes the [upto] tail search to after the head match, not the whole file", async () => {
    // "end" appears once before head-adjacent text and is unique only in the
    // suffix after the head's first (and only) match.
    await write("f.txt", "end\nSTART\nmiddle\nend\n");
    const res = await toolEdit({ path: "f.txt", old: "START[upto]end", new: "X" }, ctx);
    expect(res.isError).toBeUndefined();
    expect(await read("f.txt")).toBe("end\nX\n");
  });

  it("errors on more than one [upto] marker", async () => {
    await write("f.txt", "a\nb\nc\n");
    const res = await toolEdit({ path: "f.txt", old: "a[upto]b[upto]c", new: "x" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/more than one \[upto\]/);
  });

  it("errors when path/old/new are missing", async () => {
    expect((await toolEdit({ old: "a", new: "b" }, ctx)).isError).toBe(true);
    expect((await toolEdit({ path: "f.txt", new: "b" }, ctx)).isError).toBe(true);
    expect((await toolEdit({ path: "f.txt", old: "a" }, ctx)).isError).toBe(true);
  });

  it("respects ctx.confirm and can be declined (path outside cwd/tmp)", async () => {
    await writeFile(outsidePath, "a\nb\nc\n", "utf-8");
    ctx.confirm = async () => false;
    const res = await toolEdit({ path: outsidePath, old: "b", new: "BBB" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/not approved/);
    expect(await readFile(outsidePath, "utf-8")).toBe("a\nb\nc\n"); // unchanged
  });

  it("auto-approves an edit inside cwd without prompting", async () => {
    await write("f.txt", "a\nb\nc\n");
    const confirmSpy = vi.fn(async () => false); // would deny if called
    ctx.confirm = confirmSpy;
    const res = await toolEdit({ path: "f.txt", old: "b", new: "BBB" }, ctx);
    expect(res.isError).toBeUndefined();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(await read("f.txt")).toBe("a\nBBB\nc\n");
  });

  it("auto-approves an edit inside os.tmpdir() even when cwd is elsewhere", async () => {
    await write("f.txt", "a\nb\nc\n");
    const confirmSpy = vi.fn(async () => false);
    const otherCtx = new ToolContext("/some/unrelated/cwd", confirmSpy);
    const target = path.join(dir, "f.txt");
    const res = await toolEdit({ path: target, old: "b", new: "BBB" }, otherCtx);
    expect(res.isError).toBeUndefined();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(await read("f.txt")).toBe("a\nBBB\nc\n");
  });

  it("still requires confirmation for a path outside cwd and tmpdir", async () => {
    await writeFile(outsidePath, "a\nb\nc\n", "utf-8");
    const confirmSpy = vi.fn(async () => true);
    ctx.confirm = confirmSpy;
    const res = await toolEdit({ path: outsidePath, old: "b", new: "BBB" }, ctx);
    expect(res.isError).toBeUndefined();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(await readFile(outsidePath, "utf-8")).toBe("a\nBBB\nc\n");
  });
});
