function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function getApi(model, context = {}) {
  return lower(model?.api || context.api);
}

function getProvider(model, context = {}) {
  return lower(model?.provider || context.provider);
}

function getBaseUrl(model, context = {}) {
  return lower(model?.baseUrl || model?.base_url || context.baseUrl || context.base_url);
}

function getModelId(model, context = {}) {
  return lower(model?.id || context.id || context.modelId || context.model);
}

function normalizeBoolean(value) {
  return value === true;
}

function isOfficialDeepSeekEndpoint(model, context = {}) {
  return getProvider(model, context) === "deepseek"
    || getBaseUrl(model, context).includes("api.deepseek.com");
}

function isDeepSeekV4ModelId(id) {
  return id === "deepseek-v4" || id.startsWith("deepseek-v4-") || id.startsWith("deepseek-v4.");
}

function isDeepSeekThinkingModelId(id) {
  return id === "deepseek-reasoner" || isDeepSeekV4ModelId(id);
}

/**
 * Resolve the request-side thinking control format declared by a model.
 *
 * Precedence:
 *   1. Explicit model.compat.thinkingFormat
 *   2. Protocol quirks projected from known-models.json
 *   3. Legacy/runtime derivation for pre-existing models.json entries
 */
export function getThinkingFormat(model, context = {}) {
  if (!isPlainObject(model)) return null;

  const explicit = lower(model.compat?.thinkingFormat);
  if (explicit) return explicit;

  const quirks = Array.isArray(model.quirks) ? model.quirks : [];
  if (quirks.includes("enable_thinking")) return "qwen";

  const api = getApi(model, context);
  const provider = getProvider(model, context);
  const modelId = getModelId(model, context);

  // New models.json entries should carry compat.thinkingFormat. This branch keeps
  // already-projected runtime model objects working until the next provider sync.
  if (model.reasoning === true && api === "anthropic-messages") {
    return "anthropic";
  }

  // Built-in Anthropic models may arrive without Hana's projected compat object.
  if (provider === "anthropic" && model.reasoning !== false) {
    return "anthropic";
  }

  if (
    isOfficialDeepSeekEndpoint(model, context)
    && (model.reasoning === true || isDeepSeekThinkingModelId(modelId))
  ) {
    return "deepseek";
  }

  return null;
}

/**
 * Resolve the narrower provider/model reasoning profile.
 *
 * thinkingFormat answers "what wire family does the request body use";
 * reasoningProfile answers "which provider-specific effort/replay contract
 * applies inside that wire family".
 */
export function getReasoningProfile(model, context = {}) {
  if (!isPlainObject(model)) return null;

  const explicit = lower(model.compat?.reasoningProfile || model.compat?.thinkingProfile);
  if (explicit) return explicit;

  if (!isOfficialDeepSeekEndpoint(model, context)) return null;

  const modelId = getModelId(model, context);
  if (!isDeepSeekV4ModelId(modelId)) return null;

  const api = getApi(model, context);
  if (api === "anthropic-messages") return "deepseek-v4-anthropic";
  if (api === "openai-completions" || api === "openai-responses" || api === "") {
    return "deepseek-v4-openai";
  }

  return null;
}

export function withThinkingFormatCompat(model, context = {}) {
  if (!isPlainObject(model)) return model;

  const format = getThinkingFormat(model, context);
  const profile = getReasoningProfile(model, context);
  if (!format && !profile) return model;

  const compat = isPlainObject(model.compat) ? model.compat : {};
  if (
    (!format || lower(compat.thinkingFormat) === format)
    && (!profile || lower(compat.reasoningProfile) === profile)
  ) {
    return model;
  }

  return {
    ...model,
    compat: {
      ...compat,
      ...(format ? { thinkingFormat: format } : {}),
      ...(profile ? { reasoningProfile: profile } : {}),
    },
  };
}

/**
 * Resolve stable visual grounding capabilities for an auxiliary vision model.
 *
 * This deliberately reads an explicit capability object instead of inferring
 * from provider or model name. Plain image support means the model can see;
 * grounding means we can ask for coordinates with a known coordinate contract.
 */
export function normalizeVisionCapabilities(value) {
  if (!isPlainObject(value)) return null;
  if (!normalizeBoolean(value.grounding) && !normalizeBoolean(value.visualGrounding)) return null;

  const coordinateSpace = value.coordinateSpace === undefined || value.coordinateSpace === "norm-1000"
    ? "norm-1000"
    : null;
  let boxOrder = null;
  if (value.boxOrder === undefined || value.boxOrder === "xyxy") boxOrder = "xyxy";
  if (value.boxOrder === "yxyx") boxOrder = "yxyx";
  const boxes = value.boxes === false ? false : true;
  const points = value.points === true;
  const outputFormat = ["gemini", "qwen", "anchor", "hanako"].includes(lower(value.outputFormat))
    ? lower(value.outputFormat)
    : "hanako";
  const groundingMode = ["native", "prompted"].includes(lower(value.groundingMode))
    ? lower(value.groundingMode)
    : "native";

  if (!coordinateSpace || !boxOrder) return null;
  if (!boxes && !points) return null;

  return {
    grounding: true,
    boxes,
    points,
    coordinateSpace,
    boxOrder,
    outputFormat,
    groundingMode,
  };
}

export function getVisionCapabilities(model) {
  if (!isPlainObject(model)) return null;
  return normalizeVisionCapabilities(model.visionCapabilities);
}

export function modelSupportsVisualGrounding(model) {
  return getVisionCapabilities(model)?.grounding === true;
}
