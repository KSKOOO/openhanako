import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import registerMediaRoutes from "../routes/media.js";

let tempDirs = [];

function makeApp(bus) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hanako-image-media-"));
  tempDirs.push(dataDir);
  const app = new Hono();
  registerMediaRoutes(app, {
    dataDir,
    bus,
    log: { warn() {} },
  });
  return app;
}

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("image-gen media routes", () => {
  it("keeps built-in media providers visible when provider catalog events are unavailable", async () => {
    const app = makeApp({
      request: async () => {
        throw new Error("no provider handler");
      },
    });

    const res = await app.request("/providers?agentId=agent-1");
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(Object.keys(data.providers)).toEqual(
      expect.arrayContaining(["openai", "volcengine", "minimax", "comfyui"]),
    );
    expect(data.providers.openai.availableImageModels.map((model) => model.id)).toContain("gptimage2");
    expect(data.providers.minimax.availableAudioModels.map((model) => model.id)).toContain("speech-2.8-hd");
    expect(data.providers.comfyui.hasCredentials).toBe(true);
  });
});
