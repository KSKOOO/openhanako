/**
 * Temporary provider prompt patches.
 *
 * Deletion condition:
 * Remove this module when DeepSeek reasoning models reliably keep user-facing
 * answers in final assistant content across official and third-party providers.
 */

import { getReasoningProfile, getThinkingFormat } from "../shared/model-capabilities.js";

function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function isThinkingOff(level) {
  return level === "off" || level === "none" || level === "disabled";
}

function modelText(model) {
  return [
    model?.id,
    model?.name,
    model?.model,
    model?.modelId,
  ].map(lower).filter(Boolean).join(" ");
}

function isDeepSeekFamilyModel(model) {
  if (!model || typeof model !== "object") return false;
  const provider = lower(model.provider);
  const baseUrl = lower(model.baseUrl || model.base_url);
  const text = modelText(model);
  return provider === "deepseek"
    || provider.includes("deepseek")
    || baseUrl.includes("api.deepseek.com")
    || text.includes("deepseek-ai/")
    || text.includes("deepseek/")
    || text.includes("deepseek-");
}

function isDeepSeekReasoningModel(model) {
  if (!isDeepSeekFamilyModel(model)) return false;
  if (model.reasoning === true) return true;
  if (getThinkingFormat(model) || getReasoningProfile(model)) return true;

  const text = modelText(model);
  return text.includes("deepseek-reasoner")
    || text.includes("deepseek-r1")
    || text.includes("deepseek-v4");
}

function deepseekOutputContractPrompt(locale) {
  const isZh = String(locale || "").startsWith("zh");
  if (!isZh) {
    return [
      "If you are using a DeepSeek model, follow this DeepSeek output contract:",
      "reasoning_content / thinking is only for private reasoning scratch work.",
      "Any user-facing answer, recommendation, code, list, question, summary, or conclusion must be written into the final assistant content after thinking.",
      "Do not end a response with only reasoning_content / thinking.",
      "If you use <think> tags, close the thinking tag before emitting the final answer.",
    ].join("\n");
  }

  return [
    "如果你使用的是 DeepSeek 模型，请遵守以下 DeepSeek 输出契约：",
    "reasoning_content / thinking 只用于内部推理草稿。",
    "任何需要展示给用户的回答、建议、代码、列表、问题、摘要、结论，都必须在思考结束后写入最终 assistant content。",
    "不要只输出 reasoning_content / thinking 就结束本轮回复。",
    "如果使用 <think> 标签，必须先关闭思考标签，再输出最终回答。",
  ].join("\n");
}

export function getProviderPromptPatches(model, options = {}) {
  if (isThinkingOff(options.reasoningLevel)) return [];
  if (!isDeepSeekReasoningModel(model)) return [];
  return [deepseekOutputContractPrompt(options.locale)];
}

export const _test = {
  isDeepSeekFamilyModel,
  isDeepSeekReasoningModel,
};
