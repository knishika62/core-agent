import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { toolSearch } from "./search.js";
import { ToolContext } from "./context.js";

let dir: string;
let ctx: ToolContext;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "my-agent-search-"));
  ctx = new ToolContext(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("toolSearch", () => {
  it("finds a literal match", async () => {
    await writeFile(path.join(dir, "a.txt"), "hello world\nbye\n");
    const res = await toolSearch({ query: "world" }, ctx);
    expect(res.content).toContain("1 matches shown");
    expect(res.content).toContain("a.txt");
    expect(res.content).toContain("hello world");
  });

  it("finds a regex match", async () => {
    await writeFile(path.join(dir, "a.txt"), "foo123\nbar\n");
    const res = await toolSearch({ query: "\\d+", mode: "regex" }, ctx);
    expect(res.content).toContain("foo123");
  });

  it("reports no matches", async () => {
    await writeFile(path.join(dir, "a.txt"), "nothing here\n");
    const res = await toolSearch({ query: "xyz" }, ctx);
    expect(res.content).toBe("No matches\n");
  });

  it("skips binary files", async () => {
    await writeFile(path.join(dir, "bin.dat"), Buffer.from([0x68, 0x69, 0x00, 0x62, 0x79, 0x65]));
    const res = await toolSearch({ query: "hi" }, ctx);
    expect(res.content).toBe("No matches\n");
  });

  it("skips .git directories", async () => {
    await mkdir(path.join(dir, ".git"));
    await writeFile(path.join(dir, ".git", "config"), "needle\n");
    const res = await toolSearch({ query: "needle" }, ctx);
    expect(res.content).toBe("No matches\n");
  });

  it("is case-insensitive when requested", async () => {
    await writeFile(path.join(dir, "a.txt"), "Hello\n");
    const res = await toolSearch({ query: "hello", case_sensitive: false }, ctx);
    expect(res.content).toContain("Hello");
  });

  it("errors on an empty query", async () => {
    const res = await toolSearch({ query: "" }, ctx);
    expect(res.isError).toBe(true);
  });

  it("errors on invalid regex", async () => {
    const res = await toolSearch({ query: "(", mode: "regex" }, ctx);
    expect(res.isError).toBe(true);
  });
});
