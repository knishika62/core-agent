import { describe, it, expect, afterEach } from "vitest";
import { rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { saveSession, loadSession, listSessions } from "./session.js";

const SESSIONS_DIR = path.join(process.cwd(), "sessions");

afterEach(async () => {
  await rm(SESSIONS_DIR, { recursive: true, force: true });
});

describe("session persistence", () => {
  it("round-trips messages", async () => {
    const messages = [
      { role: "system" as const, content: "hi" },
      { role: "user" as const, content: "hello" },
    ];
    await saveSession("smoketest", messages);
    const loaded = await loadSession("smoketest");
    expect(loaded).toEqual(messages);
  });

  it("rejects path traversal in session names", async () => {
    await expect(loadSession("../evil")).rejects.toThrow(/invalid session name/);
    await expect(saveSession("../evil", [])).rejects.toThrow(/invalid session name/);
  });

  it("throws when the session file does not exist", async () => {
    await expect(loadSession("does-not-exist")).rejects.toThrow();
  });
});

describe("listSessions", () => {
  it("returns an empty array when no sessions dir exists", async () => {
    expect(await listSessions()).toEqual([]);
  });

  it("lists sessions with message counts, newest first", async () => {
    await saveSession("older", [{ role: "system", content: "s" }]);
    await new Promise((r) => setTimeout(r, 10));
    await saveSession("newer", [
      { role: "system", content: "s" },
      { role: "user", content: "hi" },
    ]);

    const sessions = await listSessions();
    expect(sessions.map((s) => s.name)).toEqual(["newer", "older"]);
    expect(sessions.find((s) => s.name === "newer")?.messageCount).toBe(2);
    expect(sessions.find((s) => s.name === "older")?.messageCount).toBe(1);
  });

  it("skips non-JSON and corrupt files instead of throwing", async () => {
    await mkdir(SESSIONS_DIR, { recursive: true });
    await writeFile(path.join(SESSIONS_DIR, "notes.txt"), "irrelevant");
    await writeFile(path.join(SESSIONS_DIR, "corrupt.json"), "{not valid json");
    await saveSession("valid", [{ role: "system", content: "s" }]);

    const sessions = await listSessions();
    expect(sessions.map((s) => s.name)).toEqual(["valid"]);
  });
});
