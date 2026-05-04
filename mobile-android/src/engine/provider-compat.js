function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function isQwenProvider(config) {
  return lower(config?.provider).includes("dashscope") || lower(config?.baseUrl).includes("dashscope") || lower(config?.modelId).includes("qwen");
}

export function isDeepSeekProvider(config) {
  return lower(config?.provider).includes("deepseek") || lower(config?.baseUrl).includes("deepseek");
}

export function isDeepSeekReasoning(config) {
  const id = lower(config?.modelId);
  return isDeepSeekProvider(config) && (id.includes("reasoner") || id.includes("deepseek-r") || id.includes("deepseek-v4"));
}

export function applyOpenAICompat(config, body) {
  const next = { ...body };
  if (isQwenProvider(config) && config.reasoningLevel && config.reasoningLevel !== "off") {
    next.enable_thinking = true;
  }
  if (isDeepSeekReasoning(config)) {
    next.temperature = undefined;
  }
  return Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined));
}

export function buildHeaders(config) {
  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  if (config.api === "anthropic-messages") {
    headers["x-api-key"] = config.apiKey || "";
    headers["anthropic-version"] = "2023-06-01";
    delete headers.Authorization;
  }
  return headers;
}

