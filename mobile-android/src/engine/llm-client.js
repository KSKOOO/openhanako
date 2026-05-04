import { requestJson } from "../mobile/native-bridge";
import { applyOpenAICompat, buildHeaders } from "./provider-compat";

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function extractTextFromOpenAI(payload) {
  const choice = payload?.choices?.[0];
  const message = choice?.message || {};
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((part) => part?.text || part?.content || "").join("").trim();
  }
  return choice?.text || "";
}

function extractTextFromResponses(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload?.output) ? payload.output : [];
  return output.flatMap((item) => item.content || [])
    .map((part) => part.text || part?.content?.[0]?.text || "")
    .join("")
    .trim();
}

function extractTextFromAnthropic(payload) {
  return (payload?.content || [])
    .map((part) => part.type === "text" ? part.text : "")
    .join("")
    .trim();
}

function extractGeneratedImage(payload, fallbackFormat = "png") {
  const first = Array.isArray(payload?.data) ? payload.data[0] : null;
  if (!first) throw new Error("图片生成接口没有返回图片数据");
  if (first.b64_json) {
    const mimeType = fallbackFormat === "jpeg" || fallbackFormat === "jpg" ? "image/jpeg" : fallbackFormat === "webp" ? "image/webp" : "image/png";
    return {
      base64Data: first.b64_json,
      mimeType,
      src: `data:${mimeType};base64,${first.b64_json}`,
      revisedPrompt: first.revised_prompt || "",
      raw: payload
    };
  }
  if (first.url) {
    return {
      url: first.url,
      src: first.url,
      mimeType: fallbackFormat === "jpeg" || fallbackFormat === "jpg" ? "image/jpeg" : fallbackFormat === "webp" ? "image/webp" : "image/png",
      revisedPrompt: first.revised_prompt || "",
      raw: payload
    };
  }
  throw new Error("图片生成接口返回格式无法识别");
}

function shouldSendImageQuality(quality) {
  return !!quality && quality !== "auto";
}

function shouldSendImageFormat(format) {
  return !!format && format !== "auto";
}

function isOptionalImageParamError(error) {
  return /response_format|output_format|quality|aspect_ratio|unknown parameter|unsupported|unrecognized|invalid field|extra field/i.test(error?.message || String(error || ""));
}

function stripOptionalImageParams(body) {
  const next = { ...body };
  delete next.response_format;
  delete next.output_format;
  delete next.aspect_ratio;
  delete next.quality;
  return next;
}

function normalizeOpenAIMessage(message) {
  if (!Array.isArray(message.content)) return message;
  return {
    role: message.role,
    content: message.content.map((part) => {
      if (part.type === "image" && part.data) {
        return { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.data}` } };
      }
      return { type: "text", text: part.text || "" };
    })
  };
}

function normalizeAnthropicMessage(message) {
  if (!Array.isArray(message.content)) return message;
  return {
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content.map((part) => {
      if (part.type === "image" && part.data) {
        return { type: "image", source: { type: "base64", media_type: part.mimeType, data: part.data } };
      }
      return { type: "text", text: part.text || "" };
    })
  };
}

export async function callModel({ config, messages, modelIdOverride } = {}) {
  if (!config?.baseUrl) throw new Error("请先配置 provider 接口地址");
  const modelId = String(modelIdOverride || config?.modelId || "").trim();
  if (!modelId) throw new Error("请先配置模型名");
  const requestConfig = { ...config, modelId };
  const headers = buildHeaders(requestConfig);

  if (config.api === "anthropic-messages") {
    const system = messages.find((message) => message.role === "system")?.content || config.systemPrompt || "";
    const body = {
      model: modelId,
      max_tokens: Number(config.maxTokens) || 4096,
      temperature: Number(config.temperature) || 0.7,
      ...(system ? { system } : {}),
      messages: messages.filter((message) => message.role !== "system").map(normalizeAnthropicMessage)
    };
    const payload = await requestJson({
      url: `${trimSlash(config.baseUrl)}/messages`,
      method: "POST",
      headers,
      data: body,
      timeout: 120000
    });
    return { text: extractTextFromAnthropic(payload), raw: payload };
  }

  if (config.api === "openai-responses") {
    const body = applyOpenAICompat(requestConfig, {
      model: modelId,
      input: messages.map(normalizeOpenAIMessage),
      temperature: Number(config.temperature) || 0.7,
      max_output_tokens: Number(config.maxTokens) || 4096
    });
    const payload = await requestJson({
      url: `${trimSlash(config.baseUrl)}/responses`,
      method: "POST",
      headers,
      data: body,
      timeout: 120000
    });
    return { text: extractTextFromResponses(payload), raw: payload };
  }

  const body = applyOpenAICompat(requestConfig, {
    model: modelId,
    messages: messages.map(normalizeOpenAIMessage),
    temperature: Number(config.temperature) || 0.7,
    max_tokens: Number(config.maxTokens) || 4096
  });
  const payload = await requestJson({
    url: `${trimSlash(config.baseUrl)}/chat/completions`,
    method: "POST",
    headers,
    data: body,
    timeout: 120000
  });
  return { text: extractTextFromOpenAI(payload), raw: payload };
}

export async function generateImage({ config, prompt, modelId, size, quality, format, aspectRatio } = {}) {
  const cleanPrompt = String(prompt || "").trim();
  if (!cleanPrompt) throw new Error("请输入图片生成提示词");
  const imageModel = String(modelId || config?.imageModelId || "").trim();
  if (!imageModel) throw new Error("请先在 AI 设置中配置图片生成模型");
  const hasDedicatedImageEndpoint = !!String(config?.imageBaseUrl || "").trim();
  const baseUrl = String(config?.imageBaseUrl || config?.baseUrl || "").trim();
  if (!baseUrl) throw new Error("请先配置图片生成接口地址");
  if (config?.api === "anthropic-messages" && !hasDedicatedImageEndpoint) throw new Error("Anthropic Messages 协议未提供 OpenAI 兼容图片生成接口，请单独填写图片生成接口地址");

  const imageConfig = {
    ...config,
    api: "openai-chat",
    baseUrl,
    apiKey: config?.imageApiKey || config?.apiKey || "",
    modelId: imageModel
  };
  const imageFormat = format || config?.imageFormat || "png";
  const body = Object.fromEntries(Object.entries({
    model: imageModel,
    prompt: cleanPrompt,
    n: 1,
    size: size || config?.imageSize || "1024x1024",
    quality: shouldSendImageQuality(quality || config?.imageQuality) ? (quality || config?.imageQuality) : undefined,
    response_format: "b64_json",
    output_format: shouldSendImageFormat(imageFormat) ? imageFormat : undefined,
    aspect_ratio: aspectRatio || config?.imageAspectRatio || undefined
  }).filter(([, value]) => value !== undefined && value !== ""));
  const url = `${trimSlash(baseUrl)}/images/generations`;
  let payload;
  try {
    payload = await requestJson({
      url,
      method: "POST",
      headers: buildHeaders(imageConfig),
      data: body,
      timeout: 180000
    });
  } catch (error) {
    if (!isOptionalImageParamError(error)) throw error;
    payload = await requestJson({
      url,
      method: "POST",
      headers: buildHeaders(imageConfig),
      data: stripOptionalImageParams(body),
      timeout: 180000
    });
  }
  return extractGeneratedImage(payload, imageFormat);
}

export async function fetchModels(config) {
  const headers = buildHeaders(config);
  const url = config.api === "anthropic-messages"
    ? `${trimSlash(config.baseUrl)}/models?limit=1000`
    : `${trimSlash(config.baseUrl)}/models`;
  const payload = await requestJson({ url, method: "GET", headers, timeout: 45000 });
  const data = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  return data.map((item) => ({ id: item.id || item.name, name: item.display_name || item.name || item.id })).filter((item) => item.id);
}
