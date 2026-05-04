import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openaiImageAdapter } from "../adapters/openai.js";

const IMAGE_RESPONSE = JSON.stringify({
  data: [{ b64_json: Buffer.from("fake-openai-image").toString("base64") }],
});

function createCtx(tmpDir) {
  return {
    dataDir: tmpDir,
    config: {
      get: (key) => {
        if (key === "defaultImageModel") return { provider: "openai", id: "gpt-image-1" };
        if (key === "providerDefaults") return {};
        return {};
      },
    },
    bus: {
      request: vi.fn(async () => ({
        apiKey: "test-key",
        baseUrl: "https://api.openai.com/v1",
      })),
    },
  };
}

describe("openaiImageAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses multipart form data for image edits", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openai-image-edit-"));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => IMAGE_RESPONSE,
    });

    const result = await openaiImageAdapter.submit({
      prompt: "restyle this",
      image: "data:image/png;base64,QUJD",
      ratio: "1:1",
    }, createCtx(tmpDir));

    expect(result.files).toHaveLength(1);
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe("https://api.openai.com/v1/images/edits");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers).not.toHaveProperty("Content-Type");
    expect(fs.existsSync(path.join(tmpDir, "generated", result.files[0]))).toBe(true);
  });

  it("falls back to generations with image_urls when edits are forbidden", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openai-image-edit-403-"));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ error: { message: "permission insufficient for image edits" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => IMAGE_RESPONSE,
      });

    const result = await openaiImageAdapter.submit({
      prompt: "restyle this",
      image: "data:image/png;base64,QUJD",
      ratio: "1:1",
    }, createCtx(tmpDir));

    expect(result.files).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/images/edits");
    expect(fetchMock.mock.calls[0][1].body).toBeInstanceOf(FormData);
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.openai.com/v1/images/generations");
    const fallbackBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(fallbackBody.image_urls).toEqual(["data:image/png;base64,QUJD"]);
    expect(fallbackBody).not.toHaveProperty("image");
    expect(fs.existsSync(path.join(tmpDir, "generated", result.files[0]))).toBe(true);
  });
});
