import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { minimaxMediaAdapter } from "../adapters/minimax-media.js";

function createCtx(tmpDir, providerDefaults = {}, baseUrl = "https://api.minimaxi.com/anthropic") {
  return {
    dataDir: tmpDir,
    config: {
      get: (key) => {
        if (key === "providerDefaults") return providerDefaults;
        return null;
      },
    },
    bus: {
      request: vi.fn(async (eventName) => {
        if (eventName === "provider:credentials") {
          return {
            apiKey: "test-key",
            baseUrl,
          };
        }
        return {};
      }),
    },
  };
}

describe("minimaxMediaAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses the MiniMax media endpoint when credentials inherit a chat base URL", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "minimax-audio-"));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: {
          audio: Buffer.from("fake-audio").toString("hex"),
        },
        base_resp: { status_code: 0 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await minimaxMediaAdapter.submit(
      { type: "audio", text: "hello", format: "mp3" },
      createCtx(tmpDir),
    );

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.minimax.io/v1/t2a_v2");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.output_format).toBe("hex");
    expect(body.audio_setting.format).toBe("mp3");
    expect(result.files).toHaveLength(1);
    expect(fs.existsSync(path.join(tmpDir, "generated", result.files[0]))).toBe(true);
  });

  it("falls back to the media endpoint when credentials inherit a legacy MiniMax API host", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "minimax-audio-"));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: {
          audio: Buffer.from("fake-audio").toString("hex"),
        },
        base_resp: { status_code: 0 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await minimaxMediaAdapter.submit(
      { type: "audio", text: "hello", format: "mp3" },
      createCtx(tmpDir, {}, "https://api.minimaxi.com/v1"),
    );

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.minimax.io/v1/t2a_v2");
  });

  it("normalizes MiniMax image parameters for size aliases and counts", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "minimax-image-"));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: {
          image_base64: Buffer.from("fake-image-payload-for-minimax").toString("base64"),
        },
        base_resp: { status_code: 0 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await minimaxMediaAdapter.submit(
      { type: "image", prompt: "a glass fox", size: "landscape", count: 12, seed: 123 },
      createCtx(tmpDir),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.minimax.io/v1/image_generation");
    expect(body.aspect_ratio).toBe("16:9");
    expect(body.n).toBe(9);
    expect(body.seed).toBe(123);
    expect(result.files).toHaveLength(1);
  });

  it("keeps MiniMax music response format separate from audio encoding format", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "minimax-music-"));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: {
          audio: Buffer.from("fake-music").toString("hex"),
        },
        base_resp: { status_code: 0 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await minimaxMediaAdapter.submit(
      { type: "music", prompt: "ambient loop", format: "mp3", output_format: "url" },
      createCtx(tmpDir),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.minimax.io/v1/music_generation");
    expect(body.output_format).toBe("url");
    expect(body.audio_setting.format).toBe("mp3");
  });
});
