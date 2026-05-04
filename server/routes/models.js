/**
 * 模型管理 REST 路由
 */
import { Hono } from "hono";
import { safeJson } from "../hono-helpers.js";
import { t } from "../i18n.js";
import { modelRefEquals, parseModelRef } from "../../shared/model-ref.js";
import { lookupKnown } from "../../shared/known-models.js";
import { callText } from "../../core/llm-client.js";

/** 查询模型显示名：overrides > SDK name > known-models > id */
function resolveModelName(id, sdkName, overrides, provider) {
  if (overrides?.[id]?.displayName) return overrides[id].displayName;
  if (sdkName && sdkName !== id) return sdkName;
  const known = lookupKnown(provider, id);
  if (known?.name) return known.name;
  return sdkName || id;
}

function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function modelSupportsXhigh(model) {
  const id = lower(model?.id);
  const known = lookupKnown(model?.provider, model?.id);
  return model?.xhigh === true
    || known?.xhigh === true
    || id.includes("gpt-5.2")
    || id.includes("gpt-5.3")
    || id.includes("gpt-5.4")
    || id.includes("opus-4-6")
    || id.includes("opus-4.6");
}

function parseHealthModelRef(body) {
  const parsed = parseModelRef(body?.model ?? body?.modelId);
  if (!parsed?.id) return { error: "modelId required" };

  const bodyProvider = typeof body.provider === "string" ? body.provider.trim() : "";
  if (parsed.provider && bodyProvider && parsed.provider !== bodyProvider) {
    return { error: "provider mismatch" };
  }

  const provider = bodyProvider || parsed.provider;
  if (!provider) return { error: "provider required" };
  return { id: parsed.id, provider };
}

export function createModelsRoute(engine) {
  const route = new Hono();

  // 列出可用模型
  route.get("/models", async (c) => {
    try {
      const overrides = engine.config?.models?.overrides;
      const cur = engine.currentModel;
      const activeModel = engine.activeSessionModel;
      const models = engine.availableModels.map(m => ({
        id: m.id,
        name: resolveModelName(m.id, m.name, overrides, m.provider),
        provider: m.provider,
        isCurrent: modelRefEquals(m, cur),
        input: Array.isArray(m.input) ? m.input : ["text"],
        reasoning: m.reasoning,
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
        ...(modelSupportsXhigh(m) ? { xhigh: true } : {}),
      }));
      return c.json({
        models,
        current: cur?.id || null,
        activeModel: activeModel ? { id: activeModel.id, provider: activeModel.provider } : null,
      });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // 健康检测：走真实 utility LLM 调用入口，验证模型存在、凭证有效、provider 兼容层可用。
  // 契约：必须提供显式复合模型引用（{id, provider} 或 modelId + provider），无按 id 兜底。
  route.post("/models/health", async (c) => {
    try {
      const body = await safeJson(c);
      const modelRef = parseHealthModelRef(body);
      if (modelRef.error) return c.json({ error: modelRef.error }, 400);

      // 统一凭证解析（找模型 + 拿凭证一步到位）
      const resolved = engine.resolveModelWithCredentials(modelRef);

      // Codex Responses API 无法简单探测
      if (resolved.api === "openai-codex-responses") {
        return c.json({ ok: true, status: 0, provider: resolved.provider, skipped: t("error.codexNoHealthCheck") });
      }

      await callText({
        api: resolved.api,
        apiKey: resolved.api_key,
        baseUrl: resolved.base_url,
        model: resolved.model,
        messages: [{ role: "user", content: "Reply OK." }],
        maxTokens: 8,
        timeoutMs: 15_000,
      });

      return c.json({ ok: true, status: 200, provider: resolved.provider });
    } catch (err) {
      return c.json({ ok: false, error: err.message });
    }
  });

  // 切换模型（下次 createSession 生效，不改活跃 session）
  route.post("/models/set", async (c) => {
    try {
      const body = await safeJson(c);
      const { modelId, provider } = body;
      if (!modelId) {
        return c.json({ error: t("error.missingParam", { param: "modelId" }) }, 400);
      }
      if (!provider) {
        return c.json({ error: t("error.missingParam", { param: "provider" }) }, 400);
      }
      engine.setPendingModel(modelId, provider);
      return c.json({ ok: true, model: engine.currentModel?.name, pendingModel: true });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // 会话内切换模型
  route.post("/models/switch", async (c) => {
    try {
      const body = await safeJson(c);
      const { sessionPath, modelId, provider } = body;
      if (!sessionPath) return c.json({ error: t("error.missingParam", { param: "sessionPath" }) }, 400);
      if (!modelId) return c.json({ error: t("error.missingParam", { param: "modelId" }) }, 400);
      if (!provider) return c.json({ error: t("error.missingParam", { param: "provider" }) }, 400);

      if (engine.isSessionStreaming(sessionPath)) {
        return c.json({ error: "cannot switch model while streaming" }, 409);
      }

      const result = await engine.switchSessionModel(sessionPath, modelId, provider);

      // Build model info for response
      const session = engine.getSessionByPath(sessionPath);
      const sessionModel = session?.model;
      const overrides = engine.config?.models?.overrides;
      const modelInfo = sessionModel ? {
        id: sessionModel.id,
        name: resolveModelName(sessionModel.id, sessionModel.name, overrides, sessionModel.provider),
        provider: sessionModel.provider,
        input: Array.isArray(sessionModel.input) ? sessionModel.input : ["text"],
        reasoning: sessionModel.reasoning,
        contextWindow: sessionModel.contextWindow,
      } : null;

      return c.json({ ok: true, model: modelInfo, adaptations: result.adaptations });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  return route;
}
