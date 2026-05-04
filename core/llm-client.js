import { AppError } from '../shared/errors.js';
import { errorBus } from '../shared/error-bus.js';
import { normalizeProviderPayload } from './provider-compat.js';
import { logLlmUsage, normalizeLlmUsage } from '../lib/llm/usage-observer.js';

/**
 * core/llm-client.js — 统一的非流式 LLM 调用入口
 *
 * 直接 HTTP POST（非流式），不走 Pi SDK 的 completeSimple（强制流式）。
 * Pi SDK completeSimple 对 DashScope 等供应商有 20-40x 延迟膨胀（stream SSE 首 token 慢），
 * utility 短文本生成（50-200 token）不需要流式，直接 POST 最快。
 *
 * URL 构造规则与 Pi SDK 内部一致，确保和 Chat 链路（走 Pi SDK stream）访问同一个端点：
 *   - openai-completions:  baseUrl + "/chat/completions"
 *   - anthropic-messages:  baseUrl + "/v1/messages"
 *   - openai-responses:    baseUrl + "/responses"
 *
 * Provider 兼容化：fetch 前统一调 normalizeProviderPayload(body, model, { mode: "utility" })，
 * 与 chat 路径（engine.js 的 Pi SDK extension）共享同一个 provider-compat 模块。
 */

function toDataUrl(block) {
  const mime = block?.mimeType || "image/png";
  const data = block?.data || "";
  return `data:${mime};base64,${data}`;
}

function normalizeTextFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("");
}

function convertContentForApi(content, api) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return typeof content === "undefined" ? "" : JSON.stringify(content);

  if (api === "anthropic-messages") {
    return content.map((block) => {
      if (block?.type === "text") return { type: "text", text: block.text || "" };
      if (block?.type === "image") {
        return {
          type: "image",
          source: {
            type: "base64",
            media_type: block.mimeType || "image/png",
            data: block.data || "",
          },
        };
      }
      return { type: "text", text: JSON.stringify(block) };
    });
  }

  if (api === "openai-responses" || api === "openai-codex-responses") {
    return content.map((block) => {
      if (block?.type === "text") return { type: "input_text", text: block.text || "" };
      if (block?.type === "image") return { type: "input_image", image_url: toDataUrl(block) };
      return { type: "input_text", text: JSON.stringify(block) };
    });
  }

  return content.map((block) => {
    if (block?.type === "text") return { type: "text", text: block.text || "" };
    if (block?.type === "image") return { type: "image_url", image_url: { url: toDataUrl(block) } };
    return { type: "text", text: JSON.stringify(block) };
  });
}

/**
 * 统一非流式文本生成。
 *
 * @param {object} opts
 * @param {string} opts.api            API 协议
 * @param {string} opts.apiKey         API key（本地模型可省略）
 * @param {string} opts.baseUrl        Provider base URL
 * @param {string|object} opts.model   模型：完整对象 {id, provider, reasoning, maxTokens, ...}
 *                                     或裸 id 字符串（旧调用方过渡期，会丢失 normalize 决策信息）
 * @param {string[]} [opts.quirks]     Provider quirk flags (e.g. ["enable_thinking"]).
 *                                     **已废弃**：仅在 modelObj.quirks 字段缺失时作 fallback。
 *                                     新代码请通过 model.quirks 传递（model-sync.js 自动从
 *                                     known-models.json 投影）。
 * @param {string} [opts.systemPrompt] System prompt
 * @param {Array}  [opts.messages]     消息数组 [{ role, content }]
 * @param {number} [opts.temperature]  温度 (default 0.3)
 * @param {number} [opts.maxTokens]    最大输出 token (default 512)
 * @param {number} [opts.timeoutMs]    超时毫秒 (default 60000)
 * @param {AbortSignal} [opts.signal]  外部取消信号
 * @param {boolean} [opts.returnUsage] 返回 { text, usage }，默认保持旧接口返回纯文本
 * @returns {Promise<string|{text: string, usage: object|null}>} 生成的文本
 */
export async function callText({
  api,
  apiKey,
  baseUrl,
  model,
  quirks = [],
  systemPrompt = "",
  messages = [],
  temperature = 0.3,
  maxTokens = 512,
  timeoutMs = 60_000,
  signal,
  returnUsage = false,
}) {
  // 同时接受完整 model 对象和裸 id。modelObj 用于 provider-compat 决策；modelId 入 payload。
  const modelObj = typeof model === "object" && model !== null ? model : null;
  const modelId = modelObj ? modelObj.id : String(model || "");
  const provider = modelObj?.provider || "custom";
  // ── 1. 消息归一化：提取 system 消息合并到 systemPrompt ──
  let mergedSystem = systemPrompt || "";
  const normalizedMessages = [];
  for (const m of messages) {
    if (m.role === "system") {
      const text = normalizeTextFromContent(m.content);
      if (text) mergedSystem += (mergedSystem ? "\n" : "") + text;
    } else {
      normalizedMessages.push({
        role: m.role,
        content: convertContentForApi(m.content, api),
      });
    }
  }

  // ── 2. 超时信号 ──
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  // ── 3. 按协议构造请求 ──
  const base = (baseUrl || "").replace(/\/+$/, "");
  let endpoint, headers, body;

  if (api === "anthropic-messages") {
    // Anthropic Messages API：baseUrl + /v1/messages（和 Pi SDK Anthropic provider 一致）
    endpoint = `${base}/v1/messages`;
    headers = { "Content-Type": "application/json", "anthropic-version": "2023-06-01" };
    if (apiKey) headers["x-api-key"] = apiKey;

    // Anthropic 格式：system 和 messages 分离
    const anthropicMessages = normalizedMessages.filter(m => m.role === "user" || m.role === "assistant");
    if (anthropicMessages.length === 0) anthropicMessages.push({ role: "user", content: "" });
    body = {
      model: modelId, temperature, max_tokens: maxTokens,
      ...(mergedSystem && { system: mergedSystem }),
      messages: anthropicMessages,
    };
  } else if (api === "openai-responses" || api === "openai-codex-responses") {
    // OpenAI Responses API
    endpoint = `${base}/responses`;
    headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    body = {
      model: modelId, temperature, max_output_tokens: maxTokens,
      ...(mergedSystem && { instructions: mergedSystem }),
      input: normalizedMessages,
    };
  } else {
    // OpenAI Completions API（默认）：baseUrl + /chat/completions
    endpoint = `${base}/chat/completions`;
    headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const allMessages = [];
    if (mergedSystem) allMessages.push({ role: "system", content: mergedSystem });
    allMessages.push(...normalizedMessages);
    body = {
      model: modelId, temperature, max_tokens: maxTokens,
      messages: allMessages,
    };
  }

  // Provider 兼容化（与 chat 路径共享 provider-compat）。
  // 把 callText opts 传入的 quirks 合入 model 对象，让 qwen.js 等子模块的
  // matches 能基于数据声明字段识别。modelObj 自身已有 quirks 时不覆盖。
  const modelForCompat = modelObj
    ? (
      Array.isArray(modelObj.quirks)
        ? { ...modelObj, api: modelObj.api ?? api }
        : { ...modelObj, api: modelObj.api ?? api, quirks }
    )
    : (
      quirks.length > 0 || api === "anthropic-messages"
        ? { id: modelId, provider, api, quirks }
        : null
    );
  body = normalizeProviderPayload(body, modelForCompat, { mode: "utility" });

  // ── 4. 发送请求 ──
  const SLOW_THRESHOLD_MS = 15_000;
  const slowTimer = setTimeout(() => {
    errorBus.report(new AppError('LLM_SLOW_RESPONSE', {
      context: { model: modelId, provider, elapsed: SLOW_THRESHOLD_MS },
    }));
  }, SLOW_THRESHOLD_MS);

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: combinedSignal,
  }).catch(err => {
    clearTimeout(slowTimer);
    if (err.name === "AbortError" || err.name === "TimeoutError") {
      throw new AppError('LLM_TIMEOUT', { context: { model: modelId }, cause: err });
    }
    throw err;
  });

  // ── 5. 解析响应 ──
  const rawText = await res.text();
  clearTimeout(slowTimer);
  let data;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    throw new Error(`LLM returned invalid JSON (status=${res.status})`);
  }

  if (!res.ok) {
    const message = data?.error?.message || data?.message || rawText || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      throw new AppError('LLM_AUTH_FAILED', { context: { model: modelId, status: res.status } });
    }
    if (res.status === 429) {
      throw new AppError('LLM_RATE_LIMITED', { context: { model: modelId } });
    }
    throw new AppError('UNKNOWN', { message, context: { model: modelId, status: res.status } });
  }

  // ── 6. 提取文本 ──
  let text = "";
  if (api === "anthropic-messages") {
    text = (data?.content || [])
      .filter(c => c?.type === "text" && typeof c.text === "string")
      .map(c => c.text).join("\n").trim();
  } else if (api === "openai-responses" || api === "openai-codex-responses") {
    if (typeof data?.output_text === "string") {
      text = data.output_text.trim();
    } else {
      text = (data?.output || [])
        .filter(item => item?.type === "message" && item?.role === "assistant")
        .flatMap(item => (item.content || []).filter(c => typeof c?.text === "string").map(c => c.text.trim()))
        .join("\n").trim();
    }
  } else {
    text = (typeof data?.choices?.[0]?.message?.content === "string")
      ? data.choices[0].message.content.trim()
      : "";
  }

  // 清理 <think> 标签（部分 provider 用标签而非 content block 包裹思考内容）
  text = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();

  if (!text) {
    if (combinedSignal.aborted) {
      throw new AppError('LLM_TIMEOUT', { context: { model: modelId } });
    }
    throw new AppError('LLM_EMPTY_RESPONSE', { context: { model: modelId } });
  }

  const usage = normalizeLlmUsage(data?.usage, { costRates: modelObj?.cost });
  logLlmUsage({
    source: "utility",
    api,
    provider,
    modelId,
    usage: data?.usage,
    costRates: modelObj?.cost,
  });

  return returnUsage ? { text, usage } : text;
}
