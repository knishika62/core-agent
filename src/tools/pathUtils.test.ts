import { describe, expect, it, afterEach } from "vitest";
import { cleanDroppedPath, isBinary } from "./pathUtils.js";

function stubPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

describe("cleanDroppedPath", () => {
  const originalPlatform = process.platform;
  afterEach(() => stubPlatform(originalPlatform));

  it("unescapes backslash-escaped spaces on non-Windows", () => {
    stubPlatform("darwin");
    expect(cleanDroppedPath("/tmp/My\\ File.png")).toBe("/tmp/My File.png");
  });

  it("strips matching surrounding quotes on non-Windows", () => {
    stubPlatform("darwin");
    expect(cleanDroppedPath("'/tmp/My File.png'")).toBe("/tmp/My File.png");
  });

  it("leaves Windows path separators intact on win32", () => {
    stubPlatform("win32");
    expect(cleanDroppedPath("C:\\Users\\PCWatch\\AppData\\Local\\Temp\\img.png")).toBe(
      "C:\\Users\\PCWatch\\AppData\\Local\\Temp\\img.png",
    );
  });

  it("still strips surrounding quotes on win32", () => {
    stubPlatform("win32");
    expect(cleanDroppedPath('"C:\\Users\\PCWatch\\img.png"')).toBe("C:\\Users\\PCWatch\\img.png");
  });
});

describe("isBinary", () => {
  it("detects a NUL byte", () => {
    expect(isBinary(Buffer.from([0x50, 0x4e, 0x47, 0x00, 0x01]))).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(isBinary(Buffer.from("hello world", "utf-8"))).toBe(false);
  });
});
