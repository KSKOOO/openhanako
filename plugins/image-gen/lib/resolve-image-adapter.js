import { openaiCompatibleImageAdapter } from "../adapters/openai-compatible.js";
import { KNOWN_IMAGE_MODELS, isOpenAICompatibleApi } from "./provider-utils.js";

const KNOWN_PROVIDER_PRIORITY = ["volcengine", "openai", "minimax", "comfyui"];

async function getProviderCredentials(bus, providerId) {
  return bus.request("provider:credentials", { providerId })
    .catch(() => ({ error: "provider_unavailable" }));
}

async function getImageModels(bus, providerId = null) {
  const payload = providerId ? { type: "image", providerId } : { type: "image" };
  const result = await bus.request("provider:models-by-type", payload)
    .catch(() => ({ models: [] }));
  return Array.isArray(result?.models) ? result.models : [];
}

async function getProviderCatalog(bus) {
  const result = await bus.request("provider:catalog", {})
    .catch(() => ({ providers: [] }));
  return Array.isArray(result?.providers) ? result.providers : [];
}

function modelIdOf(model) {
  if (typeof model === "string") return model.trim();
  return String(model?.id || "").trim();
}

function knownProviderIds() {
  const seen = new Set();
  const ids = [];
  for (const providerId of KNOWN_PROVIDER_PRIORITY) {
    if (KNOWN_IMAGE_MODELS[providerId]) {
      seen.add(providerId);
      ids.push(providerId);
    }
  }
  for (const providerId of Object.keys(KNOWN_IMAGE_MODELS)) {
    if (seen.has(providerId)) continue;
    ids.push(providerId);
  }
  return ids;
}

function firstKnownImageModelId(providerId) {
  const models = KNOWN_IMAGE_MODELS[providerId] || [];
  for (const model of models) {
    const id = modelIdOf(model);
    if (id) return id;
  }
  return null;
}

function hasUsableCredentials(creds) {
  if (!creds || creds.error) return false;
  return !!creds.apiKey || !!creds.baseUrl || !!creds.base_url || !!creds.api;
}

async function resolveProviderAdapter({ registry, bus, providerId, modelId = null, source }) {
  const direct = registry.get(providerId);
  if (direct) {
    return { adapter: direct, providerId, modelId, source: "direct" };
  }

  const creds = await getProviderCredentials(bus, providerId);
  if (!creds?.error && isOpenAICompatibleApi(creds.api)) {
    return {
      adapter: openaiCompatibleImageAdapter,
      providerId,
      modelId,
      source,
    };
  }

  return null;
}

async function resolveKnownPresetProvider({ registry, bus, providerId }) {
  const modelId = firstKnownImageModelId(providerId);
  if (!modelId) return null;

  const creds = await getProviderCredentials(bus, providerId);
  if (!hasUsableCredentials(creds)) return null;

  const direct = registry.get(providerId);
  if (direct) {
    return { adapter: direct, providerId, modelId, source: "known-preset" };
  }

  if (isOpenAICompatibleApi(creds.api)) {
    return {
      adapter: openaiCompatibleImageAdapter,
      providerId,
      modelId,
      source: "known-preset",
    };
  }

  return null;
}

export async function resolveImageAdapter({ registry, bus, inputProvider, defaultImageModel }) {
  const explicitProvider = String(inputProvider || "").trim();
  const configuredDefaultProvider = String(defaultImageModel?.provider || "").trim();
  const preferredProvider = explicitProvider || configuredDefaultProvider;

  if (preferredProvider) {
    const resolved = await resolveProviderAdapter({
      registry,
      bus,
      providerId: preferredProvider,
      modelId: configuredDefaultProvider === preferredProvider ? defaultImageModel?.id || null : null,
      source: "openai-compatible",
    });
    if (resolved) return resolved;

    if (explicitProvider) {
      return { adapter: null, providerId: preferredProvider, modelId: null, source: "missing" };
    }

    throw new Error(`Default image provider "${preferredProvider}" is not available for image generation.`);
  }

  const imageModels = await getImageModels(bus);
  for (const model of imageModels) {
    const providerId = String(model?.provider || "").trim();
    const modelId = String(model?.id || "").trim();
    if (!providerId || !modelId) continue;

    const resolved = await resolveProviderAdapter({
      registry,
      bus,
      providerId,
      modelId,
      source: "image-model",
    });
    if (resolved) return resolved;
  }

  const catalog = await getProviderCatalog(bus);
  for (const entry of catalog) {
    const providerId = String(entry?.id || "").trim();
    if (!providerId || !isOpenAICompatibleApi(entry?.api)) continue;
    const models = Array.isArray(entry?.models) ? entry.models : [];
    const modelId = modelIdOf(models[0]);
    if (!modelId) continue;

    const resolved = await resolveProviderAdapter({
      registry,
      bus,
      providerId,
      modelId,
      source: "provider-catalog",
    });
    if (resolved) return resolved;
  }

  for (const providerId of knownProviderIds()) {
    const resolved = await resolveKnownPresetProvider({ registry, bus, providerId });
    if (resolved) return resolved;
  }

  for (const adapter of registry.getByType("image")) {
    if (!adapter?.id || adapter.id === openaiCompatibleImageAdapter.id) continue;
    const creds = await getProviderCredentials(bus, adapter.id);
    if (!creds?.error) {
      return { adapter, providerId: adapter.id, modelId: null, source: "fallback" };
    }
  }

  return { adapter: null, providerId: null, modelId: null, source: "missing" };
}
