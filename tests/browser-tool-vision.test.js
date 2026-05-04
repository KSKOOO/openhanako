import { describe, expect, it, vi, beforeEach } from "vitest";
import { createBrowserTool } from "../lib/tools/browser-tool.js";
import { extractBlocks } from "../server/block-extractors.js";

const screenshotMock = vi.fn();
const isRunningMock = vi.fn();
const currentUrlMock = vi.fn();
const thumbnailMock = vi.fn();

vi.mock("../lib/browser/browser-manager.js", () => ({
  BrowserManager: {
    instance: () => ({
      screenshot: screenshotMock,
      isRunning: isRunningMock,
      currentUrl: currentUrlMock,
      thumbnail: thumbnailMock,
    }),
  },
}));

function makeCtx(sessionPath = "/tmp/session.jsonl") {
  return {
    sessionManager: {
      getSessionFile: () => sessionPath,
    },
  };
}

describe("browser screenshot vision adaptation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    screenshotMock.mockResolvedValue({ base64: "SCREENSHOT_BASE64", mimeType: "image/png" });
    isRunningMock.mockReturnValue(true);
    currentUrlMock.mockReturnValue("https://example.test/page");
    thumbnailMock.mockResolvedValue("THUMBNAIL_BASE64");
  });

  it("uses the vision bridge for text-only session models and keeps a display screenshot block", async () => {
    const prepare = vi.fn(async () => ({
      text: "Browser screenshot of https://example.test/page",
      images: undefined,
      visionNotes: ["image_overview: A page with a red warning banner."],
    }));
    const tool = createBrowserTool(() => "/tmp/session.jsonl", {
      getSessionModel: () => ({ id: "deepseek-v4-pro", provider: "deepseek", input: ["text"] }),
      getVisionBridge: () => ({ prepare }),
    });

    const result = await tool.execute("call-1", { action: "screenshot" }, null, null, makeCtx());

    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      sessionPath: "/tmp/session.jsonl",
      targetModel: { id: "deepseek-v4-pro", provider: "deepseek", input: ["text"] },
      images: [{ type: "image", data: "SCREENSHOT_BASE64", mimeType: "image/png" }],
    }));
    expect(result.content).toEqual([
      { type: "text", text: expect.stringContaining("image_overview: A page with a red warning banner.") },
    ]);
    expect(result.details).toEqual(expect.objectContaining({
      action: "screenshot",
      thumbnail: "SCREENSHOT_BASE64",
      visionAdapted: true,
    }));

    expect(extractBlocks("browser", result.details, result)).toEqual([
      { type: "screenshot", base64: "SCREENSHOT_BASE64", mimeType: "image/png" },
    ]);
  });

  it("keeps raw screenshot image content for image-capable session models", async () => {
    const prepare = vi.fn();
    const tool = createBrowserTool(() => "/tmp/session.jsonl", {
      getSessionModel: () => ({ id: "gpt-4o", provider: "openai", input: ["text", "image"] }),
      getVisionBridge: () => ({ prepare }),
    });

    const result = await tool.execute("call-1", { action: "screenshot" }, null, null, makeCtx());

    expect(prepare).not.toHaveBeenCalled();
    expect(result.content).toEqual([
      { type: "image", data: "SCREENSHOT_BASE64", mimeType: "image/png" },
    ]);
    expect(extractBlocks("browser", result.details, result)).toEqual([
      { type: "screenshot", base64: "SCREENSHOT_BASE64", mimeType: "image/png" },
    ]);
  });

  it("returns a clear error for text-only screenshot adaptation when auxiliary vision is disabled", async () => {
    const prepare = vi.fn();
    const tool = createBrowserTool(() => "/tmp/session.jsonl", {
      getSessionModel: () => ({ id: "deepseek-v4-pro", provider: "deepseek", input: ["text"] }),
      getVisionBridge: () => ({ prepare }),
      isVisionAuxiliaryEnabled: () => false,
    });

    const result = await tool.execute("call-1", { action: "screenshot" }, null, null, makeCtx());

    expect(prepare).not.toHaveBeenCalled();
    expect(result.content[0]).toEqual(expect.objectContaining({ type: "text" }));
    expect(result.details).toEqual(expect.objectContaining({
      action: "screenshot",
      thumbnail: "SCREENSHOT_BASE64",
      visionAdapted: false,
      visionError: expect.stringContaining("vision auxiliary is disabled"),
    }));
  });
});
