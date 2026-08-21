import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isPathAutoApproved, isReadOnlyBashCommand } from "./context.js";

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

describe("isReadOnlyBashCommand", () => {
  const allowlist = ["ls", "cat", "grep", "pwd"];

  it("approves allowlisted commands with plain args", () => {
    expect(isReadOnlyBashCommand("ls -lt dir", allowlist)).toBe(true);
    expect(isReadOnlyBashCommand("cat file.txt", allowlist)).toBe(true);
    expect(isReadOnlyBashCommand("grep -rn foo dir", allowlist)).toBe(true);
    expect(isReadOnlyBashCommand("pwd", allowlist)).toBe(true);
  });

  it("resolves a full path to its basename", () => {
    expect(isReadOnlyBashCommand("/bin/cat x", allowlist)).toBe(true);
  });

  it("does NOT approve commands outside the allowlist", () => {
    expect(isReadOnlyBashCommand("npm test", allowlist)).toBe(false);
    expect(isReadOnlyBashCommand("rm -rf /", allowlist)).toBe(false);
  });

  it("does NOT approve anything when the allowlist is empty (default, no config)", () => {
    expect(isReadOnlyBashCommand("ls -lt dir", [])).toBe(false);
  });

  it("does NOT approve when shell metacharacters are present", () => {
    expect(isReadOnlyBashCommand("ls; rm -rf /", allowlist)).toBe(false);
    expect(isReadOnlyBashCommand("cat f | rm x", allowlist)).toBe(false);
    expect(isReadOnlyBashCommand("cat f > out", allowlist)).toBe(false);
    expect(isReadOnlyBashCommand("ls && rm x", allowlist)).toBe(false);
    expect(isReadOnlyBashCommand("echo $(rm -rf /)", allowlist)).toBe(false);
  });

  it("does NOT approve an empty command", () => {
    expect(isReadOnlyBashCommand("", allowlist)).toBe(false);
    expect(isReadOnlyBashCommand("   ", allowlist)).toBe(false);
  });
});
