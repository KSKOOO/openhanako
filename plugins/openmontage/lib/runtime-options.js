const DEFAULT_MODE = "auto";
const DEFAULT_ASPECT_RATIO = "16:9";
const DEFAULT_RESOLUTION = "";

const PROVIDER_ENV_MAP = {
  auto: [],
  fal: ["FAL_KEY", "FAL_AI_API_KEY"],
  flux: ["FAL_KEY", "FAL_AI_API_KEY"],
  kling: ["FAL_KEY", "FAL_AI_API_KEY"],
  minimax: ["FAL_KEY", "FAL_AI_API_KEY"],
  seedance: ["FAL_KEY", "FAL_AI_API_KEY"],
  veo: ["FAL_KEY", "FAL_AI_API_KEY"],
  runway: ["RUNWAY_API_KEY", "RUNWAYML_API_SECRET"],
  heygen: ["HEYGEN_API_KEY"],
  xai: ["XAI_API_KEY"],
  grok: ["XAI_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  gemini: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  ltx: ["MODAL_LTX2_ENDPOINT_URL"],
  modal: ["MODAL_LTX2_ENDPOINT_URL"],
  "ltx2-modal": ["MODAL_LTX2_ENDPOINT_URL"],
  local: ["VIDEO_GEN_LOCAL_ENABLED", "VIDEO_GEN_LOCAL_MODEL"],
  wan: ["VIDEO_GEN_LOCAL_ENABLED", "VIDEO_GEN_LOCAL_MODEL"],
  hunyuan: ["VIDEO_GEN_LOCAL_ENABLED", "VIDEO_GEN_LOCAL_MODEL"],
  cogvideo: ["VIDEO_GEN_LOCAL_ENABLED", "VIDEO_GEN_LOCAL_MODEL"],
};

export function sanitizeTaskParams(input = {}) {
  return {
    prompt: String(input.prompt || "").trim(),
    duration: input.duration || null,
    aspectRatio: String(input.aspectRatio || DEFAULT_ASPECT_RATIO),
    resolution: String(input.resolution || DEFAULT_RESOLUTION),
    style: String(input.style || ""),
    assetsDir: String(input.assetsDir || ""),
    mode: String(input.mode || DEFAULT_MODE),
    fastMode: toBoolean(input.fastMode),
    pipeline: String(input.pipeline || ""),
    provider: String(input.provider || ""),
    model: String(input.model || ""),
    baseUrl: String(input.baseUrl || ""),
    agentBackend: String(input.agentBackend || ""),
  };
}

export function extractRuntimeOverrides(input = {}) {
  return {
    mode: input.mode,
    fastMode: input.fastMode,
    pipeline: input.pipeline,
    provider: input.provider,
    model: input.model,
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    resolution: input.resolution,
    agentBackend: input.agentBackend,
    providerEnvOverrides: input.providerEnvOverrides,
  };
}

export function resolveRuntimeOptions({
  taskParams = {},
  runtimeOverrides = {},
  config,
  env = process.env,
} = {}) {
  const mode = resolveValue("mode", runtimeOverrides, taskParams, config, env, "mode", "OPENMONTAGE_MODE", DEFAULT_MODE);
  const fastMode = resolveBoolean("fastMode", runtimeOverrides, taskParams, config, env, "fastMode", "OPENMONTAGE_FAST_MODE", false);
  const pipeline = resolveValue("pipeline", runtimeOverrides, taskParams, config, env, "pipeline", "OPENMONTAGE_PIPELINE", "");
  const provider = normalizeProvider(resolveValue("provider", runtimeOverrides, taskParams, config, env, "videoProvider", "OPENMONTAGE_VIDEO_PROVIDER", ""));
  const model = resolveValue("model", runtimeOverrides, taskParams, config, env, "videoModel", "OPENMONTAGE_VIDEO_MODEL", "");
  const apiKey = resolveValue("apiKey", runtimeOverrides, taskParams, config, env, "videoApiKey", "OPENMONTAGE_VIDEO_API_KEY", "");
  const baseUrl = resolveValue("baseUrl", runtimeOverrides, taskParams, config, env, "videoBaseUrl", "OPENMONTAGE_VIDEO_BASE_URL", "");
  const resolution = resolveValue("resolution", runtimeOverrides, taskParams, config, env, "videoResolution", "OPENMONTAGE_VIDEO_RESOLUTION", DEFAULT_RESOLUTION);
  const agentBackend = resolveValue("agentBackend", runtimeOverrides, taskParams, config, env, "agentBackend", "OPENMONTAGE_AGENT_BACKEND", "");
  const providerEnvOverrides = mergeEnvOverrides(
    readEnvOverrideSource(config, "providerEnvOverridesJson"),
    env.OPENMONTAGE_PROVIDER_ENV_OVERRIDES,
    runtimeOverrides.providerEnvOverrides,
  );

  return {
    mode,
    fastMode,
    pipeline,
    provider,
    model,
    apiKey,
    baseUrl,
    resolution,
    agentBackend,
    providerEnvOverrides,
  };
}

export function buildVideoProviderEnv(options = {}) {
  const provider = normalizeProvider(options.provider || "");
  const env = {};

  if (options.mode) env.OPENMONTAGE_MODE = String(options.mode);
  if (options.pipeline) env.OPENMONTAGE_PIPELINE = String(options.pipeline);
  if (options.resolution) env.OPENMONTAGE_VIDEO_RESOLUTION = String(options.resolution);
  env.OPENMONTAGE_FAST_MODE = options.fastMode ? "1" : "0";

  if (provider) env.OPENMONTAGE_VIDEO_PROVIDER = provider;
  if (options.model) env.OPENMONTAGE_VIDEO_MODEL = String(options.model);
  if (options.baseUrl) env.OPENMONTAGE_VIDEO_BASE_URL = String(options.baseUrl);
  if (options.agentBackend) env.OPENMONTAGE_AGENT_BACKEND = String(options.agentBackend);

  const overridePairs = Object.entries(options.providerEnvOverrides || {});
  if (overridePairs.length > 0) {
    env.OPENMONTAGE_PROVIDER_ENV_OVERRIDES = JSON.stringify(options.providerEnvOverrides);
    env.OPENMONTAGE_PROVIDER_ENV_KEYS = overridePairs.map(([key]) => key).sort().join(",");
  }

  if (options.apiKey) {
    env.OPENMONTAGE_VIDEO_API_KEY = String(options.apiKey);
    applyMappedProviderSecrets(env, provider, String(options.apiKey), String(options.baseUrl || ""), String(options.model || ""));
  } else if (options.baseUrl || options.model) {
    applyMappedProviderSecrets(env, provider, "", String(options.baseUrl || ""), String(options.model || ""));
  }

  for (const [key, value] of overridePairs) {
    env[key] = String(value);
  }

  return env;
}

export function parseResolution(value, aspectRatio = DEFAULT_ASPECT_RATIO, fastMode = false) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw) {
    const match = raw.match(/^(\d{3,5})\s*[x*]\s*(\d{3,5})$/);
    if (match) {
      return {
        width: Number(match[1]),
        height: Number(match[2]),
        source: "explicit",
      };
    }
  }

  const normalizedRatio = String(aspectRatio || DEFAULT_ASPECT_RATIO).trim();
  const presets = fastMode
    ? {
        "16:9": { width: 1280, height: 720 },
        "9:16": { width: 720, height: 1280 },
        "1:1": { width: 1080, height: 1080 },
      }
    : {
        "16:9": { width: 1920, height: 1080 },
        "9:16": { width: 1080, height: 1920 },
        "1:1": { width: 1080, height: 1080 },
      };

  const selected = presets[normalizedRatio] || presets["16:9"];
  return { ...selected, source: "preset" };
}

export function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function normalizeProvider(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveValue(runtimeKey, runtimeOverrides, taskParams, config, env, configKey, envKey, fallback) {
  const runtimeValue = runtimeOverrides?.[runtimeKey];
  if (hasMeaningfulValue(runtimeValue)) return runtimeValue;
  const taskValue = taskParams?.[runtimeKey];
  if (hasMeaningfulValue(taskValue)) return taskValue;
  const configValue = readConfig(config, configKey);
  if (hasMeaningfulValue(configValue)) return configValue;
  const envValue = env?.[envKey];
  if (hasMeaningfulValue(envValue)) return envValue;
  return fallback;
}

function resolveBoolean(runtimeKey, runtimeOverrides, taskParams, config, env, configKey, envKey, fallback) {
  const runtimeValue = runtimeOverrides?.[runtimeKey];
  if (hasMeaningfulValue(runtimeValue)) return toBoolean(runtimeValue);
  const taskValue = taskParams?.[runtimeKey];
  if (hasMeaningfulValue(taskValue)) return toBoolean(taskValue);
  const configValue = readConfig(config, configKey);
  if (hasMeaningfulValue(configValue)) return toBoolean(configValue);
  const envValue = env?.[envKey];
  if (hasMeaningfulValue(envValue)) return toBoolean(envValue);
  return fallback;
}

function readConfig(config, key) {
  if (!config || typeof config.get !== "function") return undefined;
  return config.get(key);
}

function readEnvOverrideSource(config, key) {
  const value = readConfig(config, key);
  if (!hasMeaningfulValue(value)) return undefined;
  return value;
}

function hasMeaningfulValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

function mergeEnvOverrides(...sources) {
  const merged = {};
  for (const source of sources) {
    const parsed = parseEnvOverrides(source);
    for (const [key, value] of Object.entries(parsed)) {
      merged[key] = value;
    }
  }
  return merged;
}

export function parseEnvOverrides(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return normalizeEnvObject(value);
  }
  if (typeof value !== "string") return {};

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return normalizeEnvObject(parsed);
    }
  } catch {
    // Fall through to newline parsing.
  }

  const result = {};
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const splitIndex = trimmed.indexOf("=");
    if (splitIndex <= 0) continue;
    const key = trimmed.slice(0, splitIndex).trim();
    const raw = trimmed.slice(splitIndex + 1).trim();
    if (!key) continue;
    result[key] = stripQuotes(raw);
  }
  return result;
}

function normalizeEnvObject(objectValue) {
  const result = {};
  for (const [key, value] of Object.entries(objectValue)) {
    if (!key) continue;
    if (value === undefined || value === null) continue;
    result[String(key)] = String(value);
  }
  return result;
}

function stripQuotes(value) {
  if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1);
  }
  return value;
}

function applyMappedProviderSecrets(targetEnv, provider, apiKey, baseUrl, model) {
  const mappedKeys = PROVIDER_ENV_MAP[provider] || [];
  for (const envKey of mappedKeys) {
    if (envKey === "MODAL_LTX2_ENDPOINT_URL") {
      if (baseUrl) targetEnv[envKey] = baseUrl;
      continue;
    }
    if (envKey === "VIDEO_GEN_LOCAL_ENABLED") {
      targetEnv[envKey] = "true";
      continue;
    }
    if (envKey === "VIDEO_GEN_LOCAL_MODEL") {
      if (model) targetEnv[envKey] = model;
      continue;
    }
    if (apiKey) targetEnv[envKey] = apiKey;
  }

  if (baseUrl) {
    if (provider === "openai") targetEnv.OPENAI_BASE_URL = baseUrl;
    if (provider === "google" || provider === "gemini") targetEnv.GEMINI_BASE_URL = baseUrl;
    if (provider === "modal" || provider === "ltx" || provider === "ltx2-modal") {
      targetEnv.MODAL_LTX2_ENDPOINT_URL = baseUrl;
    }
    const providerKey = provider ? provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_") : "GENERIC";
    targetEnv[`OPENMONTAGE_${providerKey}_BASE_URL`] = baseUrl;
  }
}
