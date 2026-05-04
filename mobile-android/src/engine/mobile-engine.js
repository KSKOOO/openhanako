import { callModel, fetchModels, generateImage } from "./llm-client";
import { normalizeConfig } from "./providers";
import { createId, MobileStorage, nowIso } from "./storage";
import { extractKeywords, summarizeMessages } from "./message-utils";
import { requestJson } from "../mobile/native-bridge";

const CONFIG_KEY = "config";
const SNAPSHOT_KEY = "snapshot";
const MODEL_CATALOG_LIMIT = 500;

function defaultAgents() {
  return [{
    id: "hanako",
    name: "Hanako",
    persona: "有记忆、有边界、能在手机端独立工作的私人 AI 助理。",
    systemPrompt: "你是 Hanako 的 Android 端移植版本。优先给出直接可执行的帮助，尊重用户本地数据，不假设桌面 server 存在。"
  }];
}

function defaultSnapshot() {
  const sessionPath = `mobile/session-${Date.now()}`;
  return {
    currentSessionPath: sessionPath,
    sessions: [{
      path: sessionPath,
      title: "新对话",
      summary: "还没有消息",
      created: nowIso(),
      modified: nowIso(),
      agentId: "hanako",
      agentName: "Hanako",
      keywords: []
    }],
    messagesBySession: { [sessionPath]: [] },
    memory: [],
    agents: defaultAgents(),
    activeAgentId: "hanako",
    skills: [],
    desk: [],
    tasks: [],
    configProfiles: [],
    modelCatalog: {}
  };
}

function normalizeSnapshot(input = {}) {
  const snapshot = { ...defaultSnapshot(), ...input };
  if (!Array.isArray(snapshot.agents) || !snapshot.agents.length) snapshot.agents = defaultAgents();
  if (!snapshot.activeAgentId) snapshot.activeAgentId = snapshot.agents[0].id;
  if (!snapshot.messagesBySession || typeof snapshot.messagesBySession !== "object") snapshot.messagesBySession = {};
  if (!Array.isArray(snapshot.sessions) || !snapshot.sessions.length) {
    const fresh = defaultSnapshot();
    snapshot.sessions = fresh.sessions;
    snapshot.currentSessionPath = fresh.currentSessionPath;
  }
  if (!snapshot.currentSessionPath) snapshot.currentSessionPath = snapshot.sessions[0].path;
  if (!snapshot.messagesBySession[snapshot.currentSessionPath]) snapshot.messagesBySession[snapshot.currentSessionPath] = [];
  for (const key of ["memory", "skills", "desk", "tasks", "configProfiles"]) if (!Array.isArray(snapshot[key])) snapshot[key] = [];
  if (!snapshot.modelCatalog || typeof snapshot.modelCatalog !== "object" || Array.isArray(snapshot.modelCatalog)) snapshot.modelCatalog = {};
  return snapshot;
}

function catalogKey(config, kind = "chat") {
  return [kind, config.provider || "", config.api || "", config.baseUrl || ""].map((part) => encodeURIComponent(String(part))).join(":");
}

function normalizeDiscoveredModel(item) {
  const id = String(item?.id || item?.name || "").trim();
  if (!id) return null;
  const input = Array.isArray(item?.input) ? item.input : Array.isArray(item?.modalities) ? item.modalities : [];
  return {
    id,
    name: String(item?.name || item?.displayName || item?.display_name || id),
    provider: String(item?.provider || ""),
    contextWindow: Number.isFinite(Number(item?.contextWindow || item?.context_window)) ? Number(item?.contextWindow || item?.context_window) : null,
    input
  };
}

function withCatalogProvider(model, config) {
  return { ...model, provider: model.provider || config.providerName || config.provider || "" };
}

function message({ role, content = "", images = [] }) {
  return { id: createId("msg"), role, content, images, created: nowIso() };
}

function normalizeImage(image) {
  if (!image?.base64Data) return null;
  return {
    id: image.id || createId("img"),
    name: image.name || "image.png",
    mimeType: image.mimeType || "image/png",
    base64Data: image.base64Data,
    src: image.src || `data:${image.mimeType || "image/png"};base64,${image.base64Data}`,
    size: image.size || 0
  };
}

function buildSessionMeta(path, messages, old = {}, agent) {
  const firstUser = messages.find((item) => item.role === "user" && item.content)?.content;
  const text = messages.map((item) => item.content).filter(Boolean).join(" ");
  return {
    ...old,
    path,
    title: firstUser ? firstUser.slice(0, 26) : old.title || "新对话",
    summary: summarizeMessages(messages),
    created: old.created || nowIso(),
    modified: nowIso(),
    agentId: old.agentId || agent?.id || "hanako",
    agentName: old.agentName || agent?.name || "Hanako",
    keywords: extractKeywords(text)
  };
}

function extractMemory(messages) {
  return messages
    .filter((item) => item.role === "user" && item.content && item.content.length > 12)
    .slice(-3)
    .map((item) => ({ id: createId("mem"), text: item.content.slice(0, 120), updatedAt: nowIso() }));
}

export class MobileEngine extends EventTarget {
  constructor() {
    super();
    this.storage = new MobileStorage("runtime");
    this.config = normalizeConfig(this.storage.read(CONFIG_KEY, {}));
    this.snapshot = normalizeSnapshot(this.storage.read(SNAPSHOT_KEY, {}));
    this.busy = false;
    this.capabilities = [
      { key: "capacitor", label: "Capacitor Android 容器", status: "ready", detail: "使用 Capacitor 承载 React/Vite 资源、系统文件选择器和 Android 原生插件，不再使用手写 WebView 壳。" },
      { key: "provider", label: "模型直连", status: "ready", detail: "手机端直接连接 OpenAI 兼容、Responses、Anthropic Messages 等 provider。" },
      { key: "sessions", label: "本地会话和归档", status: "ready", detail: "会话、摘要、关键词、归档和删除都在手机本地完成。" },
      { key: "context", label: "上下文中心", status: "ready", detail: "手机端展示即将注入模型的 Agent、Skills、书桌、任务和记忆，并估算上下文规模。" },
      { key: "profiles", label: "模型配置档", status: "ready", detail: "常用 provider / model / system prompt 可保存为手机本地配置档并一键切换。" },
      { key: "model-roles", label: "大小模型和视觉模型", status: "ready", detail: "手机端支持主聊天模型、小工具模型、大工具模型、视觉辅助模型和图片生成模型分槽配置。" },
      { key: "agents", label: "手机 Agent", status: "ready", detail: "桌面 Agent 适配为手机本地人格、系统提示词和会话归属。" },
      { key: "skills", label: "手机 Skills", status: "partial", detail: "提示词型 Skills 已移植；依赖 Node、Shell 或桌面文件系统的脚本型技能不可在手机 WebView 内直接执行。" },
      { key: "desk", label: "手机书桌", status: "ready", detail: "便签、网页摘录和图片资料可置顶并注入对话上下文。" },
      { key: "media", label: "多媒体", status: "partial", detail: "图片上传、预览、视觉模型路由和 OpenAI 兼容图片生成已适配；音频/视频生成仍需更多原生模块和 provider 适配。" },
      { key: "tasks", label: "前台任务", status: "partial", detail: "任务列表和 App 前台提醒已适配；后台可靠调度需要后续 Android WorkManager 原生模块。" },
      { key: "desktop-os", label: "桌面 OS 能力", status: "android-incompatible", detail: "Electron IPC、PTY、任意文件系统、电脑控制和桌面沙盒不能等价移植到纯手机运行时。" }
    ];
  }

  emitChange() {
    this.dispatchEvent(new Event("change"));
  }

  persist() {
    this.storage.write(CONFIG_KEY, this.config);
    this.storage.write(SNAPSHOT_KEY, this.snapshot);
    this.emitChange();
  }

  getState() {
    return {
      config: this.config,
      configured: this.isConfigured(),
      snapshot: this.snapshot,
      busy: this.busy,
      capabilities: this.capabilities,
      contextSummary: this.getContextSummary()
    };
  }

  isConfigured() {
    return !!(this.config.baseUrl && this.config.modelId && (this.config.apiKey || ["ollama", "custom"].includes(this.config.provider)));
  }

  isVisionConfigured() {
    return !!(this.config.visionEnabled && this.config.visionModelId && this.isConfigured());
  }

  resolveChatModelForImages(hasImages) {
    if (!hasImages) return { modelId: this.config.modelId, mode: "chat" };
    if (this.config.chatImageMode === "text-only") {
      if (!this.isVisionConfigured()) throw new Error("当前聊天模型已标记为不支持图片，请在 AI 设置中启用视觉辅助模型");
      return { modelId: this.config.visionModelId, mode: "vision-auxiliary" };
    }
    if (this.config.chatImageMode === "native-image") return { modelId: this.config.modelId, mode: "native-image" };
    if (this.isVisionConfigured()) return { modelId: this.config.visionModelId, mode: "vision-auxiliary" };
    return { modelId: this.config.modelId, mode: "unknown-image-capability" };
  }

  configure(partial) {
    this.config = normalizeConfig(partial);
    this.persist();
  }

  upsertConfigProfile(profile = {}) {
    const config = normalizeConfig(profile.config || this.config);
    const name = String(profile.name || `${config.providerName} / ${config.modelId || "未命名模型"}`).trim();
    const next = { id: profile.id || createId("profile"), name, config, updatedAt: nowIso() };
    this.snapshot.configProfiles = [next, ...this.snapshot.configProfiles.filter((item) => item.id !== next.id)].slice(0, 20);
    this.persist();
    return next;
  }

  applyConfigProfile(id) {
    const profile = this.snapshot.configProfiles.find((item) => item.id === id);
    if (!profile) return false;
    this.config = normalizeConfig(profile.config);
    this.persist();
    return true;
  }

  deleteConfigProfile(id) {
    this.snapshot.configProfiles = this.snapshot.configProfiles.filter((item) => item.id !== id);
    this.persist();
  }

  async probeModels() {
    const models = await fetchModels(this.config);
    this.cacheDiscoveredModels(this.config, models, "chat");
    return models;
  }

  async probeImageModels(configOverride = this.config) {
    const config = normalizeConfig({
      ...this.config,
      ...configOverride,
      api: "openai-chat",
      baseUrl: configOverride.imageBaseUrl || configOverride.baseUrl || this.config.imageBaseUrl || this.config.baseUrl,
      apiKey: configOverride.imageApiKey || configOverride.apiKey || this.config.imageApiKey || this.config.apiKey
    });
    const models = await fetchModels(config);
    this.cacheDiscoveredModels(config, models, "image");
    return models;
  }

  cacheDiscoveredModels(config, models, kind = "chat") {
    const normalized = (models || []).map(normalizeDiscoveredModel).filter(Boolean).map((model) => withCatalogProvider(model, config)).slice(0, MODEL_CATALOG_LIMIT);
    const key = catalogKey(config, kind);
    this.snapshot.modelCatalog = {
      ...this.snapshot.modelCatalog,
      [key]: {
        key,
        kind,
        provider: config.provider,
        api: config.api,
        baseUrl: config.baseUrl,
        models: normalized,
        updatedAt: nowIso()
      }
    };
    this.persist();
    return normalized;
  }

  getDiscoveredModels(config = this.config, kind = "chat") {
    return this.snapshot.modelCatalog?.[catalogKey(config, kind)]?.models || [];
  }

  getActiveAgent() {
    return this.snapshot.agents.find((agent) => agent.id === this.snapshot.activeAgentId) || this.snapshot.agents[0];
  }

  ensureSession() {
    if (!this.snapshot.currentSessionPath || !this.snapshot.messagesBySession[this.snapshot.currentSessionPath]) {
      this.createSession();
    }
    return this.snapshot.currentSessionPath;
  }

  createSession() {
    const agent = this.getActiveAgent();
    const path = `mobile/session-${Date.now()}`;
    this.snapshot.currentSessionPath = path;
    this.snapshot.messagesBySession[path] = [];
    this.snapshot.sessions.unshift(buildSessionMeta(path, [], {}, agent));
    this.persist();
    return path;
  }

  startNewSession() {
    return this.createSession();
  }

  getActiveSessions() {
    return this.snapshot.sessions.filter((session) => !session.archived);
  }

  getArchivedSessions() {
    return this.snapshot.sessions.filter((session) => session.archived);
  }

  switchSession(path) {
    if (!this.snapshot.messagesBySession[path]) this.snapshot.messagesBySession[path] = [];
    this.snapshot.currentSessionPath = path;
    this.persist();
  }

  archiveSession(path) {
    this.snapshot.sessions = this.snapshot.sessions.map((session) => session.path === path ? { ...session, archived: true, modified: nowIso() } : session);
    if (this.snapshot.currentSessionPath === path) {
      const next = this.getActiveSessions()[0];
      if (next) this.snapshot.currentSessionPath = next.path;
      else this.createSession();
    }
    this.persist();
  }

  restoreSession(path) {
    this.snapshot.sessions = this.snapshot.sessions.map((session) => session.path === path ? { ...session, archived: false, modified: nowIso() } : session);
    this.snapshot.currentSessionPath = path;
    this.persist();
  }

  deleteSession(path) {
    delete this.snapshot.messagesBySession[path];
    this.snapshot.sessions = this.snapshot.sessions.filter((session) => session.path !== path);
    if (!this.snapshot.sessions.length) {
      this.createSession();
      return;
    }
    if (this.snapshot.currentSessionPath === path) {
      this.snapshot.currentSessionPath = (this.getActiveSessions()[0] || this.snapshot.sessions[0]).path;
    }
    this.persist();
  }

  buildProviderMessages(path) {
    const messages = this.snapshot.messagesBySession[path] || [];
    const agent = this.getActiveAgent();
    const enabledSkills = this.snapshot.skills.filter((skill) => skill.enabled);
    const pinnedDesk = this.snapshot.desk.filter((item) => item.pinned);
    const openTasks = this.snapshot.tasks.filter((task) => !task.done);
    const pinnedMemory = this.snapshot.memory.filter((item) => item.pinned).slice(-12);
    const recentMemory = this.snapshot.memory.filter((item) => !item.pinned).slice(-10);
    const memory = [...pinnedMemory, ...recentMemory].slice(-18);
    const system = [
      this.config.systemPrompt,
      agent?.persona ? `当前手机 Agent：${agent.name}\n${agent.persona}` : "",
      agent?.systemPrompt,
      enabledSkills.length ? `<mobile-skills>\n${enabledSkills.map((skill) => `- ${skill.name}: ${skill.prompt}`).join("\n")}\n</mobile-skills>` : "",
      pinnedDesk.length ? `<mobile-desk>\n${pinnedDesk.map((item) => `- ${item.title}: ${item.body}`).join("\n")}\n</mobile-desk>` : "",
      openTasks.length ? `<mobile-tasks>\n${openTasks.map((task) => `- ${task.title}${task.dueAt ? ` / ${task.dueAt}` : ""}: ${task.detail || ""}`).join("\n")}\n</mobile-tasks>` : "",
      memory.length ? `<mobile-memory>\n${memory.map((item) => `- ${item.text}`).join("\n")}\n</mobile-memory>` : ""
    ].filter(Boolean).join("\n\n");

    const providerMessages = system ? [{ role: "system", content: system }] : [];
    for (const item of messages) {
      if (item.role === "assistant") {
        if (item.content) providerMessages.push({ role: "assistant", content: item.content });
        continue;
      }
      const parts = [];
      if (item.content) parts.push({ type: "text", text: item.content });
      for (const image of item.images || []) {
        if (image.base64Data) parts.push({ type: "image", mimeType: image.mimeType, data: image.base64Data });
      }
      if (parts.length === 1 && parts[0].type === "text") providerMessages.push({ role: "user", content: parts[0].text });
      else if (parts.length) providerMessages.push({ role: "user", content: parts });
    }
    return providerMessages;
  }

  updateSessionMeta(path) {
    const agent = this.getActiveAgent();
    const messages = this.snapshot.messagesBySession[path] || [];
    const old = this.snapshot.sessions.find((session) => session.path === path) || {};
    const meta = buildSessionMeta(path, messages, old, agent);
    this.snapshot.sessions = [meta, ...this.snapshot.sessions.filter((session) => session.path !== path)];
  }

  updateMemory(path) {
    const incoming = extractMemory(this.snapshot.messagesBySession[path] || []);
    const seen = new Set();
    this.snapshot.memory = [...this.snapshot.memory, ...incoming]
      .filter((item) => {
        const key = item.text.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(-80);
  }

  upsertMemory(text, options = {}) {
    const clean = String(text || "").trim();
    if (!clean) return null;
    const next = { id: options.id || createId("mem"), text: clean.slice(0, 240), pinned: !!options.pinned, updatedAt: nowIso() };
    this.snapshot.memory = [next, ...this.snapshot.memory.filter((item) => item.id !== next.id)].slice(0, 100);
    this.persist();
    return next;
  }

  toggleMemoryPin(id) {
    this.snapshot.memory = this.snapshot.memory.map((item) => item.id === id ? { ...item, pinned: !item.pinned, updatedAt: nowIso() } : item);
    this.persist();
  }

  deleteMemory(id) {
    this.snapshot.memory = this.snapshot.memory.filter((item) => item.id !== id);
    this.persist();
  }

  clearMemory() {
    this.snapshot.memory = [];
    this.persist();
  }

  getContextSummary(path = this.snapshot.currentSessionPath) {
    const messages = this.snapshot.messagesBySession[path] || [];
    const agent = this.getActiveAgent();
    const enabledSkills = this.snapshot.skills.filter((skill) => skill.enabled);
    const pinnedDesk = this.snapshot.desk.filter((item) => item.pinned);
    const openTasks = this.snapshot.tasks.filter((task) => !task.done);
    const pinnedMemory = this.snapshot.memory.filter((item) => item.pinned);
    const recentMemory = this.snapshot.memory.filter((item) => !item.pinned).slice(-10);
    const text = [
      this.config.systemPrompt,
      agent?.persona,
      agent?.systemPrompt,
      ...enabledSkills.map((item) => item.prompt || item.description || item.name),
      ...pinnedDesk.map((item) => `${item.title}\n${item.body || ""}`),
      ...openTasks.map((item) => `${item.title}\n${item.detail || ""}`),
      ...pinnedMemory.map((item) => item.text),
      ...recentMemory.map((item) => item.text),
      ...messages.map((item) => item.content || "")
    ].filter(Boolean).join("\n");
    return {
      messageCount: messages.length,
      imageCount: messages.reduce((sum, item) => sum + (item.images?.length || 0), 0),
      characterCount: text.length,
      estimatedTokens: Math.ceil(text.length / 3.4),
      sections: [
        { key: "agent", label: "Agent", count: agent ? 1 : 0, detail: agent?.name || "未启用" },
        { key: "skills", label: "Skills", count: enabledSkills.length, detail: enabledSkills.map((item) => item.name).join(" / ") || "未启用" },
        { key: "desk", label: "书桌置顶", count: pinnedDesk.length, detail: pinnedDesk.map((item) => item.title).join(" / ") || "无置顶资料" },
        { key: "tasks", label: "开放任务", count: openTasks.length, detail: openTasks.map((item) => item.title).join(" / ") || "无开放任务" },
        { key: "memory", label: "记忆", count: pinnedMemory.length + recentMemory.length, detail: pinnedMemory.length ? `${pinnedMemory.length} 条固定记忆` : `${recentMemory.length} 条近期记忆` }
      ]
    };
  }

  async sendMessage({ text = "", images = [] } = {}) {
    const content = String(text || "").trim();
    const normalizedImages = images.map(normalizeImage).filter(Boolean);
    if (!content && !normalizedImages.length) return null;
    if (!this.isConfigured()) throw new Error("请先配置模型 provider 和模型名");
    const path = this.ensureSession();
    const userMessage = message({ role: "user", content, images: normalizedImages });
    this.snapshot.messagesBySession[path].push(userMessage);
    this.updateSessionMeta(path);
    this.busy = true;
    this.persist();
    try {
      const modelRoute = this.resolveChatModelForImages(normalizedImages.length > 0);
      const result = await callModel({ config: this.config, messages: this.buildProviderMessages(path), modelIdOverride: modelRoute.modelId });
      const assistant = message({ role: "assistant", content: result.text || "（模型没有返回文本）" });
      assistant.raw = result.raw;
      assistant.modelRoute = modelRoute.mode;
      assistant.modelId = modelRoute.modelId;
      this.snapshot.messagesBySession[path].push(assistant);
      this.updateSessionMeta(path);
      this.updateMemory(path);
      return assistant;
    } catch (error) {
      this.snapshot.messagesBySession[path] = this.snapshot.messagesBySession[path].filter((item) => item.id !== userMessage.id);
      this.updateSessionMeta(path);
      throw error;
    } finally {
      this.busy = false;
      this.persist();
    }
  }

  async createImage({ prompt = "", options = {} } = {}) {
    const imageBaseUrl = String(this.config.imageBaseUrl || this.config.baseUrl || "").trim();
    const imageModelId = String(options.modelId || this.config.imageModelId || "").trim();
    if (!imageBaseUrl || !imageModelId) throw new Error("请先在 AI 设置中配置图片生成接口和模型");
    if (!this.config.imageApiKey && !this.config.apiKey && !["ollama", "custom"].includes(this.config.provider)) throw new Error("请先配置图片生成 API Key 或 Provider API Key");
    this.busy = true;
    this.persist();
    try {
      const result = await generateImage({
        config: this.config,
        prompt,
        modelId: options.modelId || this.config.imageModelId,
        size: options.size || this.config.imageSize,
        quality: options.quality || this.config.imageQuality,
        format: options.format || this.config.imageFormat,
        aspectRatio: options.aspectRatio || this.config.imageAspectRatio
      });
      const item = {
        type: "image",
        title: `AI 图片：${String(prompt || "").slice(0, 24) || "未命名"}`,
        body: result.revisedPrompt || prompt,
        mediaSrc: result.src,
        mimeType: result.mimeType,
        base64Data: result.base64Data,
        sourceUrl: result.url || "",
        modelId: options.modelId || this.config.imageModelId,
        pinned: true
      };
      const saved = this.upsertDeskItem(item);
      return { ...result, deskItem: saved };
    } finally {
      this.busy = false;
      this.persist();
    }
  }

  upsertAgent(agent) {
    const next = { ...agent, id: agent.id || createId("agent"), name: agent.name.trim() };
    this.snapshot.agents = [next, ...this.snapshot.agents.filter((item) => item.id !== next.id)];
    this.snapshot.activeAgentId = next.id;
    this.persist();
  }

  switchAgent(id) {
    if (this.snapshot.agents.some((agent) => agent.id === id)) {
      this.snapshot.activeAgentId = id;
      this.persist();
    }
  }

  deleteAgent(id) {
    if (this.snapshot.agents.length <= 1) return false;
    this.snapshot.agents = this.snapshot.agents.filter((agent) => agent.id !== id);
    if (this.snapshot.activeAgentId === id) this.snapshot.activeAgentId = this.snapshot.agents[0].id;
    this.persist();
    return true;
  }

  upsertSkill(skill) {
    const next = { ...skill, id: skill.id || createId("skill"), enabled: skill.enabled !== false };
    this.snapshot.skills = [next, ...this.snapshot.skills.filter((item) => item.id !== next.id)];
    this.persist();
  }

  toggleSkill(id) {
    this.snapshot.skills = this.snapshot.skills.map((skill) => skill.id === id ? { ...skill, enabled: !skill.enabled } : skill);
    this.persist();
  }

  deleteSkill(id) {
    this.snapshot.skills = this.snapshot.skills.filter((skill) => skill.id !== id);
    this.persist();
  }

  upsertDeskItem(item) {
    const next = { ...item, id: item.id || createId("desk"), updatedAt: nowIso(), pinned: item.pinned !== false };
    this.snapshot.desk = [next, ...this.snapshot.desk.filter((entry) => entry.id !== next.id)];
    this.persist();
    return next;
  }

  toggleDeskPin(id) {
    this.snapshot.desk = this.snapshot.desk.map((item) => item.id === id ? { ...item, pinned: !item.pinned } : item);
    this.persist();
  }

  deleteDeskItem(id) {
    this.snapshot.desk = this.snapshot.desk.filter((item) => item.id !== id);
    this.persist();
  }

  async clipUrl(url) {
    const clean = String(url || "").trim();
    if (!/^https?:\/\//i.test(clean)) throw new Error("请输入 http(s) URL");
    const text = await requestJson({ url: clean, method: "GET", timeout: 30000 }).catch((error) => {
      throw new Error(`网页摘录失败：${error.message}`);
    });
    const body = typeof text === "string" ? text : JSON.stringify(text);
    const title = body.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || clean;
    const compact = body.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    this.upsertDeskItem({ type: "web", title, body: compact.slice(0, 1600), sourceUrl: clean, pinned: true });
  }

  upsertTask(task) {
    const next = { ...task, id: task.id || createId("task"), updatedAt: nowIso(), done: task.done || false };
    this.snapshot.tasks = [next, ...this.snapshot.tasks.filter((item) => item.id !== next.id)];
    this.persist();
  }

  toggleTask(id) {
    this.snapshot.tasks = this.snapshot.tasks.map((task) => task.id === id ? { ...task, done: !task.done } : task);
    this.persist();
  }

  deleteTask(id) {
    this.snapshot.tasks = this.snapshot.tasks.filter((task) => task.id !== id);
    this.persist();
  }

  getDueTasks() {
    const now = Date.now();
    return this.snapshot.tasks.filter((task) => !task.done && task.dueAt && new Date(task.dueAt).getTime() <= now);
  }

  clearLocalData({ keepConfig = true } = {}) {
    this.snapshot = normalizeSnapshot({});
    if (!keepConfig) this.config = normalizeConfig({});
    this.persist();
  }

  exportPortableData() {
    return this.storage.exportAll();
  }

  importPortableData(payload) {
    this.storage.importAll(payload);
    this.config = normalizeConfig(this.storage.read(CONFIG_KEY, {}));
    this.snapshot = normalizeSnapshot(this.storage.read(SNAPSHOT_KEY, {}));
    this.persist();
  }
}

export const engine = new MobileEngine();
