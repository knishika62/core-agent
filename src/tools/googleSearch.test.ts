import { describe, it, expect, vi, afterEach } from "vitest";
import { ToolContext } from "./context.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("toolGoogleSearch with SEARCH_ENGINE_URL configured", () => {
  it("queries the configured endpoint and formats results, skipping the browser", async () => {
    vi.stubEnv("SEARCH_ENGINE_URL", "http://192.168.11.50:8888");
    vi.resetModules();
    const { initConfig } = await import("../config.js");
    initConfig();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ title: "Result A", url: "https://example.com/a", content: "snippet a" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { toolGoogleSearch } = await import("./googleSearch.js");
    const ctx = new ToolContext("/tmp");
    const result = await toolGoogleSearch({ query: "test query" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Result A");
    expect(result.content).toContain("https://example.com/a");
    expect(result.content).toContain("snippet a");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe("http://192.168.11.50:8888/search?q=test%20query&format=json");
  });

  it("reports an empty result set without erroring", async () => {
    vi.stubEnv("SEARCH_ENGINE_URL", "http://192.168.11.50:8888");
    vi.resetModules();
    const { initConfig } = await import("../config.js");
    initConfig();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) }),
    );

    const { toolGoogleSearch } = await import("./googleSearch.js");
    const ctx = new ToolContext("/tmp");
    const result = await toolGoogleSearch({ query: "nothing" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("No results");
  });

  it("returns a tool error on non-OK HTTP status", async () => {
    vi.stubEnv("SEARCH_ENGINE_URL", "http://192.168.11.50:8888");
    vi.resetModules();
    const { initConfig } = await import("../config.js");
    initConfig();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const { toolGoogleSearch } = await import("./googleSearch.js");
    const ctx = new ToolContext("/tmp");
    const result = await toolGoogleSearch({ query: "test" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("500");
  });

  it("returns a tool error when the fetch itself throws", async () => {
    vi.stubEnv("SEARCH_ENGINE_URL", "http://192.168.11.50:8888");
    vi.resetModules();
    const { initConfig } = await import("../config.js");
    initConfig();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")),
    );

    const { toolGoogleSearch } = await import("./googleSearch.js");
    const ctx = new ToolContext("/tmp");
    const result = await toolGoogleSearch({ query: "test" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("ECONNREFUSED");
  });
});
