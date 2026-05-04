export const API_PROTOCOLS = [
  { id: "openai-chat", label: "OpenAI Chat Completions" },
  { id: "openai-responses", label: "OpenAI Responses" },
  { id: "anthropic-messages", label: "Anthropic Messages" }
];

export const BUILTIN_PROVIDERS = [
  {
    id: "openai",
    displayName: "OpenAI",
    defaultApi: "openai-chat",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModels: ["gpt-4.1-mini", "gpt-4o-mini", "gpt-5.2"],
    defaultImageModels: ["gpt-image-1", "dall-e-3"],
    authType: "api-key"
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    defaultApi: "anthropic-messages",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModels: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
    defaultImageModels: [],
    authType: "api-key"
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    defaultApi: "openai-chat",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModels: ["deepseek-chat", "deepseek-reasoner"],
    defaultImageModels: [],
    authType: "api-key"
  },
  {
    id: "dashscope",
    displayName: "DashScope / Qwen",
    defaultApi: "openai-chat",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModels: ["qwen-plus", "qwen-max", "qwen3-coder-plus"],
    defaultImageModels: ["wanx2.1-t2i-turbo", "wanx2.1-t2i-plus"],
    authType: "api-key"
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    defaultApi: "openai-chat",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModels: ["openai/gpt-4.1-mini", "anthropic/claude-3.5-sonnet"],
    defaultImageModels: [],
    authType: "api-key"
  },
  {
    id: "gemini",
    displayName: "Gemini OpenAI Compatible",
    defaultApi: "openai-chat",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModels: ["gemini-2.0-flash", "gemini-1.5-pro"],
    defaultImageModels: [],
    authType: "api-key"
  },
  {
    id: "siliconflow",
    displayName: "SiliconFlow",
    defaultApi: "openai-chat",
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    defaultModels: ["Qwen/Qwen2.5-72B-Instruct", "deepseek-ai/DeepSeek-V3"],
    defaultImageModels: [],
    authType: "api-key"
  },
  {
    id: "moonshot",
    displayName: "Moonshot",
    defaultApi: "openai-chat",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModels: ["moonshot-v1-8k", "moonshot-v1-32k"],
    defaultImageModels: [],
    authType: "api-key"
  },
  {
    id: "zhipu",
    displayName: "智谱 GLM",
    defaultApi: "openai-chat",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModels: ["glm-4-flash", "glm-4-plus"],
    defaultImageModels: ["cogview-3-flash", "cogview-4"],
    authType: "api-key"
  },
  {
    id: "volcengine",
    displayName: "火山方舟",
    defaultApi: "openai-chat",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModels: ["doubao-seed-1-6", "deepseek-v3"],
    defaultImageModels: [],
    authType: "api-key"
  },
  {
    id: "xai",
    displayName: "xAI",
    defaultApi: "openai-chat",
    defaultBaseUrl: "https://api.x.ai/v1",
    defaultModels: ["grok-2-latest", "grok-2-vision-latest"],
    defaultImageModels: [],
    authType: "api-key"
  },
  {
    id: "groq",
    displayName: "Groq",
    defaultApi: "openai-chat",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultModels: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
    defaultImageModels: [],
    authType: "api-key"
  },
  {
    id: "mistral",
    displayName: "Mistral",
    defaultApi: "openai-chat",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    defaultModels: ["mistral-small-latest", "mistral-large-latest"],
    defaultImageModels: [],
    authType: "api-key"
  },
  {
    id: "perplexity",
    displayName: "Perplexity",
    defaultApi: "openai-chat",
    defaultBaseUrl: "https://api.perplexity.ai",
    defaultModels: ["sonar", "sonar-pro"],
    defaultImageModels: [],
    authType: "api-key"
  },
  {
    id: "ollama",
    displayName: "Ollama / 局域网",
    defaultApi: "openai-chat",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    defaultModels: ["llama3.1", "qwen2.5"],
    defaultImageModels: [],
    authType: "optional"
  },
  {
    id: "custom",
    displayName: "自定义 OpenAI 兼容",
    defaultApi: "openai-chat",
    defaultBaseUrl: "",
    defaultModels: [],
    defaultImageModels: [],
    authType: "optional"
  }
];

export function getProviderPreset(id) {
  return BUILTIN_PROVIDERS.find((provider) => provider.id === id) || BUILTIN_PROVIDERS[0];
}

function boundedNumber(value, fallback, min, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(max, Math.max(min, next));
}

function firstUsefulModel(input, fallback) {
  return String(input || fallback || "").trim();
}

export function normalizeConfig(input = {}) {
  const preset = getProviderPreset(input.provider || "openai");
  const modelId = firstUsefulModel(input.modelId, preset.defaultModels?.[0]);
  const utilityModelId = firstUsefulModel(input.utilityModelId, modelId || preset.defaultModels?.[0]);
  const utilityLargeModelId = firstUsefulModel(input.utilityLargeModelId, preset.defaultModels?.[2] || preset.defaultModels?.[1] || utilityModelId);
  const visionModelId = firstUsefulModel(input.visionModelId, input.visionEnabled ? modelId : "");
  const imageModelId = firstUsefulModel(input.imageModelId, preset.defaultImageModels?.[0] || "");
  return {
    provider: input.provider || preset.id,
    providerName: preset.displayName,
    api: input.api || preset.defaultApi,
    baseUrl: input.baseUrl || preset.defaultBaseUrl || "",
    apiKey: input.apiKey || "",
    modelId,
    utilityModelId,
    utilityLargeModelId,
    visionEnabled: input.visionEnabled === true || input.visionEnabled === "true",
    visionModelId,
    chatImageMode: ["unknown", "native-image", "text-only"].includes(input.chatImageMode) ? input.chatImageMode : "unknown",
    imageBaseUrl: String(input.imageBaseUrl || "").trim(),
    imageApiKey: input.imageApiKey || "",
    imageModelId,
    imageSize: input.imageSize || "1024x1024",
    imageAspectRatio: input.imageAspectRatio || "",
    imageFormat: input.imageFormat || "png",
    imageQuality: input.imageQuality || "auto",
    maxImageCount: boundedNumber(input.maxImageCount, 4, 1, 8),
    maxImageSizeMb: boundedNumber(input.maxImageSizeMb, 12, 1, 32),
    temperature: Number.isFinite(Number(input.temperature)) ? Number(input.temperature) : 0.7,
    maxTokens: Number.isFinite(Number(input.maxTokens)) ? Number(input.maxTokens) : 4096,
    reasoningLevel: input.reasoningLevel || "off",
    systemPrompt: input.systemPrompt || ""
  };
}
