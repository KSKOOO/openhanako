import { beforeEach, describe, expect, it, vi } from "vitest";

const searchWebMock = vi.fn();

vi.mock("../lib/browser/browser-manager.js", () => ({
  BrowserManager: {
    instance: () => ({
      searchWeb: searchWebMock,
    }),
  },
}));

import {
  createWebSearchTool,
  searchProviderRequiresApiKey,
  verifySearchKey,
} from "../lib/tools/web-search.js";

describe("web_search browser providers", () => {
  beforeEach(() => {
    searchWebMock.mockReset();
  });

  it("does not require API keys for browser-backed providers", async () => {
    expect(searchProviderRequiresApiKey("bing_browser")).toBe(false);
    expect(searchProviderRequiresApiKey("google_browser")).toBe(false);
    expect(searchProviderRequiresApiKey("duckduckgo_browser")).toBe(false);
    await expect(verifySearchKey("bing_browser", "")).resolves.toBe(true);
  });

  it("returns Tavily-like structured details from a browser provider", async () => {
    searchWebMock.mockResolvedValue({
      query: "hana search",
      provider: "bing_browser",
      source_type: "browser",
      results: [
        {
          title: "Result",
          url: "https://example.com",
          content: "Snippet",
          rank: 1,
          score: null,
          metadata: { display_url: "example.com", engine: "bing" },
        },
      ],
      diagnostics: {
        final_url: "https://www.bing.com/search?q=hana+search",
        blocked: false,
        captcha: false,
        elapsed_ms: 1234,
      },
    });

    const tool = createWebSearchTool({
      searchConfigResolver: () => ({ provider: "bing_browser", api_key: "" }),
    });
    const result = await tool.execute("call-1", { query: "hana search", maxResults: 3 });

    expect(searchWebMock).toHaveBeenCalledWith({
      provider: "bing_browser",
      query: "hana search",
      maxResults: 3,
    });
    expect(result.details).toMatchObject({
      query: "hana search",
      provider: "bing_browser",
      source_type: "browser",
      results: [
        {
          title: "Result",
          url: "https://example.com",
          content: "Snippet",
          rank: 1,
          metadata: { engine: "bing" },
        },
      ],
      diagnostics: {
        blocked: false,
        captcha: false,
      },
    });
    expect(result.content[0].type).toBe("text");
  });

  it("defaults to Bing browser search when no search provider is configured", async () => {
    searchWebMock.mockResolvedValue({
      query: "hana default",
      provider: "bing_browser",
      source_type: "browser",
      results: [
        {
          title: "Default Result",
          url: "https://example.com/default",
          content: "Default snippet",
          rank: 1,
          score: null,
          metadata: { engine: "bing" },
        },
      ],
      diagnostics: {
        final_url: "https://www.bing.com/search?q=hana+default",
        blocked: false,
        captcha: false,
      },
    });

    const tool = createWebSearchTool({
      searchConfigResolver: () => ({ provider: "", api_key: "" }),
    });
    const result = await tool.execute("call-2", { query: "hana default", maxResults: 2 });

    expect(searchWebMock).toHaveBeenCalledWith({
      provider: "bing_browser",
      query: "hana default",
      maxResults: 2,
    });
    expect(result.details).toMatchObject({
      query: "hana default",
      provider: "bing_browser",
      source_type: "browser",
      results: [
        {
          title: "Default Result",
          url: "https://example.com/default",
          content: "Default snippet",
          rank: 1,
          metadata: { engine: "bing" },
        },
      ],
    });
  });
});
