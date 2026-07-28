import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ToolContext } from "./context.js";

const openMock = vi.fn().mockResolvedValue(undefined);
vi.mock("open", () => ({ default: (...args: unknown[]) => openMock(...args) }));

let dir: string;
let ctx: ToolContext;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "core-agent-showmedia-"));
  ctx = new ToolContext(dir);
  openMock.mockClear();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("toolShowMedia", () => {
  it("opens an existing file in the default app", async () => {
    const { toolShowMedia } = await import("./showMedia.js");
    await writeFile(path.join(dir, "photo.png"), "fake-png-bytes");

    const result = await toolShowMedia({ path: "photo.png" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("photo.png");
    expect(openMock).toHaveBeenCalledTimes(1);
    expect(openMock).toHaveBeenCalledWith(path.join(dir, "photo.png"));
  });

  it("errors when path is missing", async () => {
    const { toolShowMedia } = await import("./showMedia.js");
    const result = await toolShowMedia({}, ctx);
    expect(result.isError).toBe(true);
    expect(openMock).not.toHaveBeenCalled();
  });

  it("errors when the file does not exist, without calling open()", async () => {
    const { toolShowMedia } = await import("./showMedia.js");
    const result = await toolShowMedia({ path: "nope.png" }, ctx);
    expect(result.isError).toBe(true);
    expect(openMock).not.toHaveBeenCalled();
  });

  it("unescapes a drag-and-dropped path before opening it", async () => {
    const { toolShowMedia } = await import("./showMedia.js");
    await writeFile(path.join(dir, "my file.mp4"), "fake-video-bytes");

    const result = await toolShowMedia({ path: "my\\ file.mp4" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(openMock).toHaveBeenCalledWith(path.join(dir, "my file.mp4"));
  });

  it("skips open() when ctx.skipMediaOpen is set (GUI's inline viewer takes its place)", async () => {
    const { toolShowMedia } = await import("./showMedia.js");
    await writeFile(path.join(dir, "photo.png"), "fake-png-bytes");
    ctx.skipMediaOpen = true;

    const result = await toolShowMedia({ path: "photo.png" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("photo.png");
    expect(openMock).not.toHaveBeenCalled();
  });
});
