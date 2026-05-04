import { describe, it, expect } from "vitest";
import {
  buildMediaProviders,
  normalizeProviderModels,
  isOpenAICompatibleApi,
} from "../lib/provider-utils.js";

describe("provider-utils", () => {
  it("includes custom openai-compatible providers in media list", () => {
    const providers = buildMediaProviders({
      catalog: [
        {
          id: "custom-image",
          displayName: "Custom Image",
          api: "openai-completions",
          isBuiltin: false,
          isConfigured: true,
          hasCredentials: true,
          models: [],
        },
      ],
      imageModels: [],
    });

    expect(providers["custom-image"]).toBeDefined();
    expect(providers["custom-image"].displayName).toBe("Custom Image");
    expect(providers["custom-image"].hasCredentials).toBe(true);
  });

  it("reuses configured provider models as image candidates", () => {
    const providers = buildMediaProviders({
      catalog: [
        {
          id: "openrouter",
          displayName: "OpenRouter",
          api: "openai-completions",
          isBuiltin: true,
          isConfigured: true,
          hasCredentials: true,
          models: [
            { id: "img-alpha", name: "IMG Alpha" },
            "img-beta",
          ],
        },
      ],
      imageModels: [],
    });

    expect(providers.openrouter).toBeDefined();
    expect(providers.openrouter.availableModels.map((model) => model.id)).toEqual([
      "img-alpha",
      "img-beta",
    ]);
  });

  it("infers untyped configured image models for providers that already have known image models", () => {
    const providers = buildMediaProviders({
      catalog: [
        {
          id: "openai",
          displayName: "OpenAI",
          api: "openai-completions",
          isBuiltin: true,
          isConfigured: true,
          hasCredentials: true,
          models: [
            { id: "gptimage2", name: "GPT Image 2 Alias" },
            { id: "flux-1-dev" },
            { id: "gpt-4.1" },
          ],
        },
      ],
      imageModels: [],
    });

    const ids = providers.openai.availableImageModels.map((model) => model.id);
    expect(ids).toContain("gptimage2");
    expect(ids).toContain("flux-1-dev");
    expect(ids).toContain("gpt-image-2");
    expect(ids).not.toContain("gpt-4.1");
  });

  it("infers common text-to-image model aliases as image candidates", () => {
    const providers = buildMediaProviders({
      catalog: [
        {
          id: "openai",
          displayName: "OpenAI",
          api: "openai-completions",
          isBuiltin: false,
          isConfigured: true,
          hasCredentials: true,
          models: [
            { id: "text-to-image-pro" },
            { id: "txt2img-xl" },
            { id: "img2img-edit" },
            { id: "chat-model" },
          ],
        },
      ],
      imageModels: [],
    });

    const ids = providers.openai.availableImageModels.map((model) => model.id);
    expect(ids).toContain("text-to-image-pro");
    expect(ids).toContain("txt2img-xl");
    expect(ids).toContain("img2img-edit");
    expect(ids).not.toContain("chat-model");
  });

  it("keeps preset providers visible even before models are added", () => {
    const providers = buildMediaProviders({ catalog: [], imageModels: [] });
    expect(providers.openai).toBeDefined();
    expect(providers.volcengine).toBeDefined();
    expect(providers.minimax).toBeDefined();
    expect(providers.comfyui).toBeDefined();
    expect(providers.openai.availableModels.length).toBeGreaterThan(0);
    expect(providers.minimax.availableAudioModels.map((model) => model.id)).toContain("speech-2.8-hd");
    expect(providers.minimax.availableMusicModels.map((model) => model.id)).toContain("music-2.6");
  });

  it("marks local openai-compatible providers as credential-ready", () => {
    const providers = buildMediaProviders({
      catalog: [
        {
          id: "local-image",
          displayName: "Local Image",
          api: "openai-completions",
          baseUrl: "http://127.0.0.1:7860/v1",
          isBuiltin: false,
          isConfigured: true,
          hasCredentials: false,
          models: [{ id: "local-image-model", type: "image" }],
        },
      ],
      imageModels: [],
    });

    expect(providers["local-image"]).toBeDefined();
    expect(providers["local-image"].hasCredentials).toBe(true);
    expect(providers["local-image"].availableModels.map((model) => model.id)).toContain("local-image-model");
  });

  it("normalizes mixed provider model entries", () => {
    expect(normalizeProviderModels([
      "model-a",
      { id: "model-b", name: "Model B" },
      null,
      { id: "" },
    ])).toEqual([
      { id: "model-a", name: "model-a" },
      { id: "model-b", name: "Model B" },
    ]);
  });

  it("preserves explicit media model types and dedupes by type", () => {
    const providers = buildMediaProviders({
      catalog: [
        {
          id: "minimax",
          displayName: "MiniMax",
          api: "anthropic-messages",
          isBuiltin: true,
          isConfigured: true,
          hasCredentials: true,
          models: [
            { id: "image-01", type: "image" },
            { id: "speech-2.8-hd", type: "audio" },
            { id: "music-2.6", type: "music" },
            { id: "MiniMax-M2.7" },
          ],
        },
      ],
      imageModels: [{ provider: "minimax", id: "image-01", name: "MiniMax Image 01" }],
      audioModels: [{ provider: "minimax", id: "speech-2.8-hd", name: "MiniMax Speech 2.8 HD" }],
      musicModels: [{ provider: "minimax", id: "music-2.6", name: "MiniMax Music 2.6" }],
    });

    expect(providers.minimax.imageModels).toEqual([
      { id: "image-01", name: "MiniMax Image 01", type: "image" },
    ]);
    expect(providers.minimax.audioModels).toEqual([
      { id: "speech-2.8-hd", name: "MiniMax Speech 2.8 HD", type: "audio" },
    ]);
    expect(providers.minimax.musicModels).toEqual([
      { id: "music-2.6", name: "MiniMax Music 2.6", type: "music" },
    ]);
    expect(providers.minimax.availableImageModels.map((model) => model.id)).not.toContain("MiniMax-M2.7");
  });

  it("allows the same model id in different media types", () => {
    const providers = buildMediaProviders({
      catalog: [
        {
          id: "custom-media",
          displayName: "Custom Media",
          api: "openai-completions",
          isBuiltin: false,
          isConfigured: true,
          hasCredentials: true,
          models: [
            { id: "shared-model", type: "image" },
            { id: "shared-model", type: "audio" },
          ],
        },
      ],
      imageModels: [{ provider: "custom-media", id: "shared-model" }],
      audioModels: [{ provider: "custom-media", id: "shared-model" }],
    });

    expect(providers["custom-media"].imageModels).toHaveLength(1);
    expect(providers["custom-media"].audioModels).toHaveLength(1);
  });

  it("recognizes openai-compatible api format", () => {
    expect(isOpenAICompatibleApi("openai-completions")).toBe(true);
    expect(isOpenAICompatibleApi("anthropic-messages")).toBe(false);
  });
});
