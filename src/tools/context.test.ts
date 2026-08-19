import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isPathAutoApproved } from "./context.js";

describe("isPathAutoApproved", () => {
  it("approves exact cwd match", () => {
    expect(isPathAutoApproved("/foo/bar", "/foo/bar")).toBe(true);
  });

  it("approves a subdirectory of cwd", () => {
    expect(isPathAutoApproved("/foo/bar", "/foo/bar/baz/x.txt")).toBe(true);
  });

  it("does NOT approve a sibling dir with a shared string prefix", () => {
    expect(isPathAutoApproved("/foo/bar", "/foo/barbaz/x.txt")).toBe(false);
  });

  it("does NOT approve a path outside both cwd and tmpdir", () => {
    expect(isPathAutoApproved("/foo/bar", "/etc/hosts")).toBe(false);
  });

  it("approves a path inside the real OS tmpdir even when cwd is elsewhere", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "core-agent-ctxtest-"));
    try {
      expect(isPathAutoApproved("/some/unrelated/cwd", path.join(dir, "f.txt"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
