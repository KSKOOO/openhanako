import { describe, expect, it } from "vitest";
import {
  normalizeProviderPayload,
  normalizeProviderContextMessages,
  isDeepSeekModel,
  isAnthropicModel,
  getThinkingFormat,
  getReasoningProfile,
} from "../core/provider-compat.js";

describe("isDeepSeekModel", () => {
  it("只把官方 DeepSeek provider / baseUrl 视为 DeepSeek 兼容路径", () => {
    expect(isDeepSeekModel({ provider: "deepseek" })).toBe(true);
    expect(isDeepSeekModel({ baseUrl: "https://api.deepseek.com/v1" })).toBe(true);
    expect(isDeepSeekModel({ provider: "openrouter", id: "deepseek/deepseek-v3.2" })).toBe(false);
  });
});

describe("isAnthropicModel", () => {
  it("匹配 anthropic provider", () => {
    expect(isAnthropicModel({ provider: "anthropic" })).toBe(true);
    expect(isAnthropicModel({ provider: "openai" })).toBe(false);
  });
});

describe("getThinkingFormat", () => {
  it("优先读取模型显式 thinkingFormat 声明", () => {
    expect(getThinkingFormat({
      provider: "kimi-coding",
      api: "anthropic-messages",
      reasoning: true,
      compat: { thinkingFormat: "anthropic" },
    })).toBe("anthropic");
    expect(getThinkingFormat({
      provider: "dashscope",
      api: "openai-completions",
      reasoning: true,
      compat: { thinkingFormat: "qwen" },
    })).toBe("qwen");
  });

  it("仅 api=anthropic-messages 但无 reasoning/format 声明时不猜 thinking 格式", () => {
    expect(getThinkingFormat({
      provider: "custom-anthropic-proxy",
      api: "anthropic-messages",
      reasoning: false,
      compat: { supportsDeveloperRole: false },
    })).toBe(null);
  });

  it("兼容旧 models.json：reasoning + anthropic-messages 可读时派生 anthropic 格式", () => {
    expect(getThinkingFormat({
      provider: "kimi-coding",
      api: "anthropic-messages",
      reasoning: true,
      compat: { supportsDeveloperRole: false },
    })).toBe("anthropic");
  });
});

describe("getReasoningProfile", () => {
  it("显式 reasoningProfile 优先于派生规则", () => {
    expect(getReasoningProfile({
      provider: "custom",
      api: "anthropic-messages",
      reasoning: true,
      compat: { reasoningProfile: "deepseek-v4-anthropic" },
    })).toBe("deepseek-v4-anthropic");
  });

  it("DeepSeek V4 官方 Anthropic endpoint 派生为 deepseek-v4-anthropic", () => {
    expect(getReasoningProfile({
      id: "deepseek-v4-pro",
      provider: "deepseek",
      api: "anthropic-messages",
      baseUrl: "https://api.deepseek.com/anthropic",
      reasoning: true,
    })).toBe("deepseek-v4-anthropic");
  });

  it("Kimi / MiniMax Anthropic-compatible 模型不被误判成 DeepSeek profile", () => {
    expect(getReasoningProfile({
      id: "kimi-k2.6",
      provider: "kimi-coding",
      api: "anthropic-messages",
      reasoning: true,
      compat: { thinkingFormat: "anthropic" },
    })).toBe(null);
    expect(getReasoningProfile({
      id: "MiniMax-M2.7",
      provider: "minimax",
      api: "anthropic-messages",
      reasoning: true,
      compat: { thinkingFormat: "anthropic" },
    })).toBe(null);
  });
});

describe("normalizeProviderPayload — 通用层", () => {
  it("剥离空 tools 数组（dashscope/volcengine 兼容）", () => {
    const payload = {
      model: "qwen3.6-flash",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    };
    const result = normalizeProviderPayload(payload, { provider: "dashscope" });
    expect(result).not.toHaveProperty("tools");
  });

  it("剥离未声明 thinking 格式的 provider thinking 字段", () => {
    const payload = {
      model: "custom-chat",
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "enabled" },
    };
    const result = normalizeProviderPayload(payload, {
      provider: "custom-anthropic-proxy",
      api: "anthropic-messages",
      reasoning: false,
      compat: { supportsDeveloperRole: false },
    });
    expect(result).not.toHaveProperty("thinking");
  });

  it("Kimi Coding 这类 Anthropic-compatible reasoning 模型保留 thinking", () => {
    const payload = {
      model: "kimi-k2.6",
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "enabled", budget_tokens: 8192 },
    };
    const result = normalizeProviderPayload(payload, {
      provider: "kimi-coding",
      api: "anthropic-messages",
      reasoning: true,
      compat: { supportsDeveloperRole: false, thinkingFormat: "anthropic" },
    });
    expect(result.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
  });

  it("MiniMax Anthropic-compatible reasoning 模型保留 thinking", () => {
    const payload = {
      model: "MiniMax-M2.7",
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "enabled", budget_tokens: 4096 },
    };
    const result = normalizeProviderPayload(payload, {
      provider: "minimax",
      api: "anthropic-messages",
      reasoning: true,
      compat: { supportsDeveloperRole: false, thinkingFormat: "anthropic" },
    });
    expect(result.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
  });

  it("anthropic 模型保留 thinking", () => {
    const payload = {
      model: "claude-opus-4-7",
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "enabled" },
    };
    const result = normalizeProviderPayload(payload, { provider: "anthropic" });
    expect(result.thinking).toEqual({ type: "enabled" });
  });

  it("无 model 信息时保留 thinking 不误删", () => {
    const payload = {
      model: "unknown",
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "enabled" },
    };
    const result = normalizeProviderPayload(payload, null);
    expect(result.thinking).toEqual({ type: "enabled" });
  });
});

describe("normalizeProviderPayload — DeepSeek Anthropic 模式", () => {
  const deepseekAnthropicModel = {
    id: "deepseek-v4-pro",
    provider: "deepseek",
    api: "anthropic-messages",
    baseUrl: "https://api.deepseek.com/anthropic",
    reasoning: true,
    maxTokens: 384000,
    compat: { thinkingFormat: "anthropic", reasoningProfile: "deepseek-v4-anthropic" },
  };

  it("xhigh 映射到 Anthropic 格式 output_config.effort=max，且不泄漏 OpenAI reasoning_effort", () => {
    const payload = {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "enabled", budget_tokens: 16384, display: "summarized" },
      reasoning_effort: "high",
      max_tokens: 32000,
    };
    const result = normalizeProviderPayload(payload, deepseekAnthropicModel, {
      mode: "chat",
      reasoningLevel: "xhigh",
    });
    expect(result).not.toBe(payload);
    expect(result.thinking).toEqual({ type: "enabled", budget_tokens: 16384 });
    expect(result.output_config).toEqual({ effort: "max" });
    expect(result).not.toHaveProperty("reasoning_effort");
    expect(result.max_tokens).toBe(32000);
    expect(payload).toHaveProperty("reasoning_effort", "high");
  });

  it("high 映射到 Anthropic 格式 output_config.effort=high", () => {
    const payload = {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "enabled", budget_tokens: 8192 },
    };
    const result = normalizeProviderPayload(payload, deepseekAnthropicModel, {
      mode: "chat",
      reasoningLevel: "high",
    });
    expect(result.output_config).toEqual({ effort: "high" });
    expect(result).not.toHaveProperty("reasoning_effort");
  });

  it("off 显式关闭 Anthropic thinking，并移除 output_config / reasoning_effort", () => {
    const payload = {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "enabled", budget_tokens: 8192 },
      output_config: { effort: "max" },
      reasoning_effort: "max",
    };
    const result = normalizeProviderPayload(payload, deepseekAnthropicModel, {
      mode: "chat",
      reasoningLevel: "off",
    });
    expect(result.thinking).toEqual({ type: "disabled" });
    expect(result).not.toHaveProperty("output_config");
    expect(result).not.toHaveProperty("reasoning_effort");
  });

  it("Kimi Anthropic-compatible payload 不被加 DeepSeek output_config", () => {
    const payload = {
      model: "kimi-k2.6",
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "enabled", budget_tokens: 8192 },
    };
    const result = normalizeProviderPayload(payload, {
      id: "kimi-k2.6",
      provider: "kimi-coding",
      api: "anthropic-messages",
      reasoning: true,
      compat: { thinkingFormat: "anthropic" },
    }, { mode: "chat", reasoningLevel: "xhigh" });
    expect(result).toBe(payload);
    expect(result).not.toHaveProperty("output_config");
  });
});

describe("normalizeProviderContextMessages — DeepSeek Anthropic replay", () => {
  const deepseekAnthropicModel = {
    id: "deepseek-v4-pro",
    provider: "deepseek",
    api: "anthropic-messages",
    baseUrl: "https://api.deepseek.com/anthropic",
    reasoning: true,
    compat: { thinkingFormat: "anthropic", reasoningProfile: "deepseek-v4-anthropic" },
  };

  it("thinking 开启时，Anthropic tool replay 缺少非空 thinking 原文会 fail closed", () => {
    const messages = [
      { role: "user", content: "look up date" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "", thinkingSignature: "sig" },
          { type: "toolCall", id: "call_1", name: "date", arguments: {} },
        ],
      },
      { role: "toolResult", toolCallId: "call_1", toolName: "date", content: [{ type: "text", text: "ok" }] },
    ];
    expect(() => normalizeProviderContextMessages(messages, deepseekAnthropicModel, {
      mode: "chat",
      reasoningLevel: "high",
    })).toThrow(/DeepSeek.*Anthropic.*thinking.*tool/);
  });

  it("thinking 开启且 tool replay 有非空 thinking 原文时不改消息引用", () => {
    const messages = [
      { role: "user", content: "look up date" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "need date", thinkingSignature: "sig" },
          { type: "toolCall", id: "call_1", name: "date", arguments: {} },
        ],
      },
      { role: "toolResult", toolCallId: "call_1", toolName: "date", content: [{ type: "text", text: "ok" }] },
    ];
    expect(normalizeProviderContextMessages(messages, deepseekAnthropicModel, {
      mode: "chat",
      reasoningLevel: "high",
    })).toBe(messages);
  });

  it("thinking off 时不校验 Anthropic tool replay", () => {
    const messages = [
      { role: "user", content: "look up date" },
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call_1", name: "date", arguments: {} },
        ],
      },
    ];
    expect(normalizeProviderContextMessages(messages, deepseekAnthropicModel, {
      mode: "chat",
      reasoningLevel: "off",
    })).toBe(messages);
  });
});

describe("normalizeProviderPayload — DeepSeek chat 模式", () => {
  const deepseekModel = {
    id: "deepseek-v4-pro",
    provider: "deepseek",
    reasoning: true,
    maxTokens: 384000,
  };

  it("非 DeepSeek 模型不动 DeepSeek 专用字段", () => {
    const payload = {
      model: "gpt-5.4",
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "medium",
      max_completion_tokens: 32000,
    };
    const result = normalizeProviderPayload(payload, { provider: "openai", reasoning: true }, { mode: "chat" });
    expect(result.reasoning_effort).toBe("medium");
    expect(result.max_completion_tokens).toBe(32000);
  });

  it("DeepSeek 无工具思考请求使用官方 max_tokens，并抬过 high thinking budget", () => {
    const payload = {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "medium",
      max_completion_tokens: 32000,
    };
    const result = normalizeProviderPayload(payload, deepseekModel, { mode: "chat" });
    expect(result).not.toBe(payload);
    expect(result).toMatchObject({
      model: "deepseek-v4-pro",
      reasoning_effort: "high",
      max_tokens: 65536,
    });
    expect(result).not.toHaveProperty("max_completion_tokens");
    expect(payload).toHaveProperty("max_completion_tokens", 32000);
  });

  it("DeepSeek V4 xhigh 会按官方兼容规则转成 max", () => {
    const payload = {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "high",
      max_completion_tokens: 32000,
    };
    const result = normalizeProviderPayload(payload, deepseekModel, {
      mode: "chat",
      reasoningLevel: "xhigh",
    });
    expect(result).toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "max",
      max_tokens: 131072,
    });
  });

  it("DeepSeek V4 off 会显式关闭官方思考模式", () => {
    const payload = {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 32000,
    };
    const result = normalizeProviderPayload(payload, deepseekModel, {
      mode: "chat",
      reasoningLevel: "off",
    });
    expect(result).toMatchObject({ thinking: { type: "disabled" } });
    expect(result).not.toHaveProperty("reasoning_effort");
    expect(result.max_tokens).toBe(32000);
  });

  it("DeepSeek 已经足够大的 max_tokens 不被放大", () => {
    const payload = {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "high",
      max_tokens: 50000,
    };
    const result = normalizeProviderPayload(payload, deepseekModel, { mode: "chat" });
    expect(result.max_tokens).toBe(50000);
  });

  it("DeepSeek V4 工具请求保留官方思考协议和 reasoning_content", () => {
    const payload = {
      model: "deepseek-v4-pro",
      messages: [
        { role: "user", content: "look up date" },
        {
          role: "assistant",
          content: null,
          reasoning_content: "Need to call the date tool.",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "date", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "call_1", content: "2026-04-24" },
      ],
      tools: [{ type: "function", function: { name: "date", parameters: { type: "object" } } }],
      reasoning_effort: "medium",
      max_completion_tokens: 32000,
    };
    const result = normalizeProviderPayload(payload, deepseekModel, {
      mode: "chat",
      reasoningLevel: "xhigh",
    });
    expect(result).toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "max",
      max_tokens: 131072,
    });
    expect(result).not.toHaveProperty("max_completion_tokens");
    expect(result.messages[1]).toHaveProperty("reasoning_content", "Need to call the date tool.");
    expect(payload.messages[1]).toHaveProperty("reasoning_content");
  });

  it("DeepSeek v4 即使缺少本地 reasoning 标记，也按默认思考模式防护", () => {
    const payload = {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "look up date" }],
      tools: [{ type: "function", function: { name: "date", parameters: { type: "object" } } }],
    };
    const result = normalizeProviderPayload(payload, {
      id: "deepseek-v4-pro",
      provider: "deepseek",
    }, { mode: "chat" });
    expect(result).toMatchObject({
      thinking: { type: "enabled" },
      max_tokens: 65536,
    });
  });
});

describe("normalizeProviderPayload — DeepSeek utility 模式", () => {
  const deepseekV4 = {
    id: "deepseek-v4-flash",
    provider: "deepseek",
    reasoning: true,
    maxTokens: 384000,
  };

  it("utility 模式下 DeepSeek reasoning 模型主动 disableThinking（避免短输出耗光思考预算）", () => {
    const payload = {
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 50,
    };
    const result = normalizeProviderPayload(payload, deepseekV4, { mode: "utility" });
    expect(result).toMatchObject({ thinking: { type: "disabled" } });
    // utility 不放大 max_tokens：保留调用方传入的 50
    expect(result.max_tokens).toBe(50);
  });

  it("utility 模式下普通 DeepSeek 非 reasoning 模型不被改", () => {
    const payload = {
      model: "deepseek-chat",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 100,
    };
    const result = normalizeProviderPayload(payload, {
      id: "deepseek-chat",
      provider: "deepseek",
      reasoning: false,
    }, { mode: "utility", reasoningLevel: "high" });
    expect(result).not.toHaveProperty("thinking");
    expect(result.max_tokens).toBe(100);
  });

  it("utility 模式默认就是 utility，不传 mode 时按 chat 处理", () => {
    const payload = {
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 50,
    };
    // 默认 mode = "chat"，会拉 max_tokens
    const result = normalizeProviderPayload(payload, deepseekV4);
    expect(result.max_tokens).toBe(65536);
  });
});

describe("normalizeProviderPayload — 边界条件", () => {
  it("payload 非对象时原样返回", () => {
    expect(normalizeProviderPayload(null, { provider: "deepseek" })).toBe(null);
    expect(normalizeProviderPayload(undefined, { provider: "deepseek" })).toBe(undefined);
  });

  it("无 messages 字段的 DeepSeek payload 不抛错", () => {
    const payload = { model: "deepseek-v4-pro" };
    const result = normalizeProviderPayload(payload, {
      id: "deepseek-v4-pro",
      provider: "deepseek",
      reasoning: true,
    }, { mode: "chat" });
    // 没 messages 数组，DeepSeek 兼容层直接放过
    expect(result).toBe(payload);
  });
});
