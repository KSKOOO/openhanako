import { inferMediaTypeFromModelId } from "../../../shared/model-type-inference.js";

function isLocalBaseUrl(url = "") {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(String(url || ""));
}

export function isLocalOpenAICompatibleProvider(entry = {}) {
  return isOpenAICompatibleApi(entry.api) && isLocalBaseUrl(entry.baseUrl || entry.base_url || "");
}

const MEDIA_TYPES = ["image", "audio", "music"];

export const IMAGE_PROVIDER_PRESETS = [
  { id: "volcengine", displayName: "Volcengine (Doubao)" },
  { id: "openai", displayName: "OpenAI" },
  { id: "minimax", displayName: "MiniMax" },
  { id: "comfyui", displayName: "ComfyUI", credentialsOptional: true, defaultBaseUrl: "http://127.0.0.1:8188" },
];

export const KNOWN_MODELS_BY_TYPE = {
  image: {
    volcengine: [
      { id: "doubao-seedream-3-0-t2i", name: "Seedream 3.0", type: "image" },
      { id: "doubao-seedream-4-0-250828", name: "Seedream 4.0", type: "image" },
      { id: "doubao-seedream-4-5-251128", name: "Seedream 4.5", type: "image" },
      { id: "doubao-seedream-5-0", name: "Seedream 5.0", type: "image" },
      { id: "doubao-seedream-5-0-pro", name: "Seedream 5.0 Pro", type: "image" },
      { id: "doubao-seedream-5-0-lite-260128", name: "Seedream 5.0 Lite", type: "image" },
    ],
    openai: [
      { id: "gpt-image-1", name: "GPT Image 1", type: "image" },
      { id: "gpt-image-1.5", name: "GPT Image 1.5", type: "image" },
      { id: "gpt-image-1-mini", name: "GPT Image 1 Mini", type: "image" },
      { id: "gpt-image-2", name: "GPT Image 2", type: "image" },
      { id: "gptimage2", name: "GPT Image 2", type: "image" },
      { id: "dall-e-3", name: "DALL-E 3", type: "image" },
    ],
    minimax: [
      { id: "image-01", name: "MiniMax Image 01", type: "image" },
    ],
    comfyui: [
      { id: "workflow", name: "ComfyUI Workflow", type: "image" },
    ],
  },
  audio: {
    minimax: [
      { id: "speech-2.8-hd", name: "MiniMax Speech 2.8 HD", type: "audio" },
      { id: "speech-2.8-turbo", name: "MiniMax Speech 2.8 Turbo", type: "audio" },
    ],
  },
  music: {
    minimax: [
      { id: "music-2.6", name: "MiniMax Music 2.6", type: "music" },
    ],
  },
};

export const KNOWN_IMAGE_MODELS = KNOWN_MODELS_BY_TYPE.image;

export function isOpenAICompatibleApi(api = "") {
  const normalized = String(api || "").trim().toLowerCase();
  return normalized === "openai-completions" || normalized === "openai";
}

export function normalizeProviderModels(models = [], fallbackType = null) {
  return models
    .map((model) => {
      if (!model) return null;
      if (typeof model === "string") {
        const id = model.trim();
        if (!id) return null;
        return fallbackType ? { id, name: id, type: fallbackType } : { id, name: id };
      }
      const id = String(model.id || "").trim();
      if (!id) return null;
      const type = String(model.type || fallbackType || "").trim();
      return type
        ? { id, name: model.name || id, type }
        : { id, name: model.name || id };
    })
    .filter(Boolean);
}

export function dedupeModels(models = []) {
  const seen = new Set();
  const result = [];
  for (const model of models) {
    const id = String(model?.id || "").trim();
    const type = String(model?.type || "").trim();
    const key = `${type}:${id}`;
    if (!id || seen.has(key)) continue;
    seen.add(key);
    result.push(type ? { id, name: model.name || id, type } : { id, name: model.name || id });
  }
  return result;
}

function modelsByProvider(models = [], type) {
  const byProvider = new Map();
  for (const model of models || []) {
    const providerId = String(model?.provider || "").trim();
    const id = String(model?.id || "").trim();
    if (!providerId || !id) continue;
    const current = byProvider.get(providerId) || [];
    current.push({ id, name: model.name || id, type });
    byProvider.set(providerId, current);
  }
  return byProvider;
}

function knownModels(providerId, type) {
  return KNOWN_MODELS_BY_TYPE[type]?.[providerId] || [];
}

function configuredModelsForType(entry, providerId, type) {
  const hasKnownModels = knownModels(providerId, type).length > 0;
  const fallbackType = type === "image" && isOpenAICompatibleApi(entry.api) && !hasKnownModels ? "image" : null;
  return normalizeProviderModels(entry.models || [], fallbackType)
    .map((model) => {
      if (model.type) return model;
      const inferredType = inferMediaTypeFromModelId(model.id, providerId);
      return inferredType ? { ...model, type: inferredType } : model;
    })
    .filter((model) => model.type === type);
}

function candidatesForType({ entry = {}, providerId, type, addedModels = [] }) {
  const addedKeys = new Set(addedModels.map((model) => `${model.type || type}:${model.id}`));
  const configuredCandidates = configuredModelsForType(entry, providerId, type)
    .filter((model) => !addedKeys.has(`${model.type || type}:${model.id}`));
  const knownCandidates = knownModels(providerId, type)
    .filter((model) => !addedKeys.has(`${model.type || type}:${model.id}`));
  return {
    configuredCandidates,
    availableModels: dedupeModels([...configuredCandidates, ...knownCandidates]),
  };
}

function buildProviderResult({ providerId, entry = {}, preset = null, modelsByType = {} }) {
  const typeData = {};
  for (const type of MEDIA_TYPES) {
    const addedModels = dedupeModels(modelsByType[type]?.get(providerId) || []);
    const { configuredCandidates, availableModels } = candidatesForType({
      entry,
      providerId,
      type,
      addedModels,
    });
    typeData[type] = { addedModels, configuredCandidates, availableModels };
  }

  const hasAnyModel = MEDIA_TYPES.some((type) => typeData[type].addedModels.length > 0);
  const hasAnyCandidate = MEDIA_TYPES.some((type) =>
    typeData[type].configuredCandidates.length > 0 || typeData[type].availableModels.length > 0,
  );
  const baseUrl = entry.baseUrl || entry.base_url || preset?.defaultBaseUrl || "";
  const shouldInclude =
    hasAnyModel
    || !!preset
    || (!entry.isBuiltin && isOpenAICompatibleApi(entry.api))
    || (!!entry.isConfigured && isOpenAICompatibleApi(entry.api) && hasAnyCandidate)
    || (isOpenAICompatibleApi(entry.api) && isLocalBaseUrl(baseUrl));

  if (!shouldInclude) return null;

  const hasCredentials = !!entry.hasCredentials
    || !!preset?.credentialsOptional
    || isLocalBaseUrl(baseUrl);

  return {
    providerId,
    displayName: preset?.displayName || entry.displayName || providerId,
    hasCredentials,
    baseUrl,
    api: entry.api || "",
    isLocalOpenAICompatible: isLocalOpenAICompatibleProvider({ ...entry, baseUrl }),
    imageModels: typeData.image.addedModels,
    audioModels: typeData.audio.addedModels,
    musicModels: typeData.music.addedModels,
    availableImageModels: typeData.image.availableModels,
    availableAudioModels: typeData.audio.availableModels,
    availableMusicModels: typeData.music.availableModels,
    models: typeData.image.addedModels,
    availableModels: typeData.image.availableModels,
  };
}

export function buildMediaProviders({
  catalog = [],
  imageModels = [],
  audioModels = [],
  musicModels = [],
} = {}) {
  const result = {};
  const presetMap = new Map(IMAGE_PROVIDER_PRESETS.map((preset) => [preset.id, preset]));
  const groupedModels = {
    image: modelsByProvider(imageModels, "image"),
    audio: modelsByProvider(audioModels, "audio"),
    music: modelsByProvider(musicModels, "music"),
  };

  for (const entry of catalog || []) {
    const providerId = String(entry?.id || "").trim();
    if (!providerId) continue;
    const provider = buildProviderResult({
      providerId,
      entry,
      preset: presetMap.get(providerId),
      modelsByType: groupedModels,
    });
    if (provider) result[providerId] = provider;
  }

  for (const preset of IMAGE_PROVIDER_PRESETS) {
    if (result[preset.id]) continue;
    const provider = buildProviderResult({
      providerId: preset.id,
      entry: {},
      preset,
      modelsByType: groupedModels,
    });
    if (provider) result[preset.id] = provider;
  }

  return result;
}
