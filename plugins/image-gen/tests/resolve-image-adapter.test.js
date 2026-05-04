import { describe, it, expect } from "vitest";
import { AdapterRegistry } from "../lib/adapter-registry.js";
import { resolveImageAdapter } from "../lib/resolve-image-adapter.js";

const directAdapter = {
  id: "openai",
  name: "OpenAI",
  types: ["image"],
};

describe("resolveImageAdapter", () => {
  it("prefers a directly registered adapter", async () => {
    const registry = new AdapterRegistry();
    registry.register(directAdapter);

    const resolved = await resolveImageAdapter({
      registry,
      bus: { request: async () => ({ error: "unused" }) },
      inputProvider: "openai",
      defaultImageModel: null,
    });

    expect(resolved.adapter).toBe(directAdapter);
    expect(resolved.providerId).toBe("openai");
    expect(resolved.source).toBe("direct");
  });

  it("falls back to openai-compatible adapter for custom providers", async () => {
    const registry = new AdapterRegistry();

    const resolved = await resolveImageAdapter({
      registry,
      bus: {
        request: async ({ providerId }) => ({
          providerId,
          api: "openai-completions",
          apiKey: "sk-test",
        }),
      },
      inputProvider: "custom-image",
      defaultImageModel: null,
    });

    expect(resolved.adapter?.id).toBe("openai-compatible");
    expect(resolved.providerId).toBe("custom-image");
    expect(resolved.source).toBe("openai-compatible");
  });

  it("uses default image provider when no explicit provider is passed", async () => {
    const registry = new AdapterRegistry();

    const resolved = await resolveImageAdapter({
      registry,
      bus: {
        request: async () => ({
          api: "openai-completions",
          apiKey: "sk-test",
        }),
      },
      inputProvider: "",
      defaultImageModel: { id: "img-pro", provider: "custom-image" },
    });

    expect(resolved.adapter?.id).toBe("openai-compatible");
    expect(resolved.providerId).toBe("custom-image");
  });

  it("returns missing adapter for unsupported explicit providers", async () => {
    const registry = new AdapterRegistry();

    const resolved = await resolveImageAdapter({
      registry,
      bus: {
        request: async () => ({
          api: "anthropic-messages",
          apiKey: "sk-test",
        }),
      },
      inputProvider: "custom-image",
      defaultImageModel: null,
    });

    expect(resolved).toEqual({
      adapter: null,
      providerId: "custom-image",
      modelId: null,
      source: "missing",
    });
  });

  it("auto-selects a configured image model when no default is set", async () => {
    const registry = new AdapterRegistry();

    const resolved = await resolveImageAdapter({
      registry,
      bus: {
        request: async (type, payload) => {
          if (type === "provider:models-by-type" && payload.type === "image") {
            return { models: [{ provider: "sglang", id: "image-model", type: "image" }] };
          }
          if (type === "provider:credentials" && payload.providerId === "sglang") {
            return {
              api: "openai-completions",
              baseUrl: "http://127.0.0.1:30000/v1",
            };
          }
          return {};
        },
      },
      inputProvider: "",
      defaultImageModel: null,
    });

    expect(resolved.adapter?.id).toBe("openai-compatible");
    expect(resolved.providerId).toBe("sglang");
    expect(resolved.modelId).toBe("image-model");
    expect(resolved.source).toBe("image-model");
  });

  it("can fall back to an OpenAI-compatible provider catalog model", async () => {
    const registry = new AdapterRegistry();

    const resolved = await resolveImageAdapter({
      registry,
      bus: {
        request: async (type, payload) => {
          if (type === "provider:models-by-type") return { models: [] };
          if (type === "provider:catalog") {
            return {
              providers: [{
                id: "sglang",
                api: "openai-completions",
                models: [{ id: "local-image-model" }],
              }],
            };
          }
          if (type === "provider:credentials" && payload.providerId === "sglang") {
            return {
              api: "openai-completions",
              baseUrl: "http://127.0.0.1:30000/v1",
            };
          }
          return {};
        },
      },
      inputProvider: "",
      defaultImageModel: null,
    });

    expect(resolved.adapter?.id).toBe("openai-compatible");
    expect(resolved.providerId).toBe("sglang");
    expect(resolved.modelId).toBe("local-image-model");
    expect(resolved.source).toBe("provider-catalog");
  });

  it("uses known image presets for configured OpenAI-compatible providers without added image models", async () => {
    const registry = new AdapterRegistry();

    const resolved = await resolveImageAdapter({
      registry,
      bus: {
        request: async (type, payload) => {
          if (type === "provider:models-by-type") return { models: [] };
          if (type === "provider:catalog") return { providers: [] };
          if (type === "provider:credentials" && payload.providerId === "openai") {
            return {
              api: "openai-completions",
              apiKey: "sk-test",
              baseUrl: "https://api.openai.com/v1",
            };
          }
          return { error: "no_credentials" };
        },
      },
      inputProvider: "",
      defaultImageModel: null,
    });

    expect(resolved.adapter?.id).toBe("openai-compatible");
    expect(resolved.providerId).toBe("openai");
    expect(resolved.modelId).toBe("gpt-image-1");
    expect(resolved.source).toBe("known-preset");
  });

  it("uses known image presets for configured direct local providers", async () => {
    const registry = new AdapterRegistry();
    const comfyAdapter = { id: "comfyui", name: "ComfyUI", types: ["image"] };
    registry.register(comfyAdapter);

    const resolved = await resolveImageAdapter({
      registry,
      bus: {
        request: async (type, payload) => {
          if (type === "provider:models-by-type") return { models: [] };
          if (type === "provider:catalog") return { providers: [] };
          if (type === "provider:credentials" && payload.providerId === "comfyui") {
            return {
              api: "",
              baseUrl: "http://127.0.0.1:8188",
            };
          }
          return { error: "no_credentials" };
        },
      },
      inputProvider: "",
      defaultImageModel: null,
    });

    expect(resolved.adapter).toBe(comfyAdapter);
    expect(resolved.providerId).toBe("comfyui");
    expect(resolved.modelId).toBe("workflow");
    expect(resolved.source).toBe("known-preset");
  });

  it("does not auto-select unconfigured remote known providers", async () => {
    const registry = new AdapterRegistry();
    registry.register(directAdapter);

    const resolved = await resolveImageAdapter({
      registry,
      bus: {
        request: async (type) => {
          if (type === "provider:models-by-type") return { models: [] };
          if (type === "provider:catalog") return { providers: [] };
          return { error: "no_credentials" };
        },
      },
      inputProvider: "",
      defaultImageModel: null,
    });

    expect(resolved).toEqual({
      adapter: null,
      providerId: null,
      modelId: null,
      source: "missing",
    });
  });
});
