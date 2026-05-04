import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { engine } from "./engine/mobile-engine";
import { API_PROTOCOLS, BUILTIN_PROVIDERS, getProviderPreset } from "./engine/providers";
import { chooseImages, downloadText, readImageFiles } from "./mobile/native-bridge";
import { formatRelativeTime } from "./engine/message-utils";
import hanakoAvatar from "../../desktop/src/assets/Hanako.png";
import "./styles.css";

const SPLASH_LINES = [
  "Hanako 想起了那天傍晚的光",
  "有些句子在记忆里发了芽",
  "Ta 在回忆里找到了你的轮廓",
  "风穿过那些旧对话",
  "那些文字泡在时间里，变得很软",
  "Hanako 记得你那天笑了很久",
  "有一段记忆被你折了角",
  "Ta 把散落的情绪重新收好",
  "Hanako 闻到了某个下午的橘子味",
  "那些对话还带着体温"
];

function useEngineState() {
  const [state, setState] = useState(() => engine.getState());
  useEffect(() => {
    const update = () => setState(engine.getState());
    engine.addEventListener("change", update);
    return () => engine.removeEventListener("change", update);
  }, []);
  return state;
}

function toast(message) {
  window.dispatchEvent(new CustomEvent("hanako-toast", { detail: String(message || "") }));
}

function formatBytes(bytes = 0) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function uniqueItems(items) {
  return [...new Set(items.filter(Boolean).map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeModelOption(item, fallbackProvider = "") {
  if (typeof item === "string") return { id: item, name: item, provider: fallbackProvider, input: [] };
  const id = String(item?.id || item?.name || "").trim();
  if (!id) return null;
  return {
    id,
    name: String(item?.name || item?.displayName || id),
    provider: String(item?.provider || fallbackProvider || ""),
    contextWindow: item?.contextWindow || item?.context_window || null,
    input: Array.isArray(item?.input) ? item.input : []
  };
}

function buildModelOptions(...groups) {
  const seen = new Set();
  return groups.flat().map((item) => normalizeModelOption(item)).filter(Boolean).filter((item) => {
    const key = `${item.provider}/${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function modelLooksLikeImage(model) {
  const text = `${model.id} ${model.name}`.toLowerCase();
  return /image|dall|gpt-image|cogview|wanx|flux|sdxl|stable|midjourney|seedream|imagen|text-to-image|t2i/.test(text);
}

function modelLooksLikeVision(model) {
  const text = `${model.id} ${model.name}`.toLowerCase();
  return model.input?.includes("image") || /vision|vl|gpt-4o|gemini|grok|qwen.*omni|qwen.*vl|claude-3/.test(text);
}

function ModelPicker({ label, hint, value, options, onChange, placeholder, filter, allowCustom = true }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [custom, setCustom] = useState("");
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const visibleOptions = useMemo(() => {
    const list = filter ? options.filter(filter) : options;
    const query = search.trim().toLowerCase();
    return query ? list.filter((item) => `${item.provider} ${item.name} ${item.id}`.toLowerCase().includes(query)) : list;
  }, [filter, options, search]);
  const selected = options.find((item) => item.id === value) || null;
  const grouped = useMemo(() => visibleOptions.reduce((acc, item) => {
    const key = item.provider || "Provider";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {}), [visibleOptions]);

  useEffect(() => {
    if (!open) return;
    const handler = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [open]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 40);
  }, [open]);

  function choose(id) {
    onChange(id);
    setOpen(false);
    setSearch("");
  }

  function submitCustom() {
    const clean = custom.trim();
    if (!clean) return;
    choose(clean);
    setCustom("");
  }

  return <div className="model-picker" ref={rootRef}><label>{label}</label><button type="button" className={`model-trigger${open ? " open" : ""}`} onClick={() => setOpen((value) => !value)}><span><strong>{selected?.name || value || placeholder || "选择模型"}</strong><small>{selected ? `${selected.provider || "本地"} / ${selected.id}${selected.contextWindow ? ` · ${selected.contextWindow}` : ""}` : hint || "探测后可从真实模型列表选择"}</small></span><em>▾</em></button>{open && <div className="model-dropdown"><input ref={inputRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索模型" /><div className="model-options">{Object.entries(grouped).map(([provider, items]) => <div key={provider}><div className="model-group-title">{provider}<span>{items.length}</span></div>{items.map((item) => <button key={`${item.provider}/${item.id}`} type="button" className={item.id === value ? "selected" : ""} onClick={() => choose(item.id)}><span>{item.name || item.id}</span><small>{item.id}</small></button>)}</div>)}{!visibleOptions.length && <div className="model-empty">没有匹配模型。可探测 API，或在下方手动输入。</div>}</div>{allowCustom && <div className="model-custom"><input value={custom} onChange={(event) => setCustom(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submitCustom(); }} placeholder="手动输入模型 ID" /><button type="button" onClick={submitCustom}>↵</button></div>}</div>}</div>;
}

function ToastHost() {
  const [message, setMessage] = useState("");
  useEffect(() => {
    const listener = (event) => {
      setMessage(event.detail);
      window.clearTimeout(listener.timer);
      listener.timer = window.setTimeout(() => setMessage(""), 2400);
    };
    window.addEventListener("hanako-toast", listener);
    return () => window.removeEventListener("hanako-toast", listener);
  }, []);
  return message ? <div className="toast">{message}</div> : null;
}

function MobileSplash({ onDone }) {
  const [lineIndex, setLineIndex] = useState(() => Math.floor(Math.random() * SPLASH_LINES.length));
  const [switching, setSwitching] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const onDoneRef = useRef(onDone);

  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    let switchTimer = 0;
    const cycleTimer = window.setInterval(() => {
      setSwitching(true);
      switchTimer = window.setTimeout(() => {
        setLineIndex((index) => (index + 1) % SPLASH_LINES.length);
        setSwitching(false);
      }, reduceMotion ? 0 : 400);
    }, 3000);
    const leaveTimer = window.setTimeout(() => setLeaving(true), reduceMotion ? 900 : 3000);
    const doneTimer = window.setTimeout(() => onDoneRef.current?.(), reduceMotion ? 1100 : 3550);
    return () => {
      window.clearInterval(cycleTimer);
      window.clearTimeout(switchTimer);
      window.clearTimeout(leaveTimer);
      window.clearTimeout(doneTimer);
    };
  }, []);

  return (
    <div className={`mobile-splash${leaving ? " leaving" : ""}`} role="status" aria-live="polite" aria-label="Hanako 正在启动">
      <div className="mobile-splash-container">
        <img className="mobile-splash-avatar" src={hanakoAvatar} alt="" draggable={false} />
        <div className="mobile-splash-text-row">
          <p className={`mobile-splash-text${switching ? " switching" : ""}`}>{SPLASH_LINES[lineIndex]}</p>
          <span className="mobile-splash-sakura">✿</span>
        </div>
      </div>
    </div>
  );
}

function ConfigPage({ state, onNavigate }) {
  const [form, setForm] = useState(state.config);
  const [probing, setProbing] = useState(false);
  const [probingImages, setProbingImages] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState(() => engine.getDiscoveredModels(state.config, "chat"));
  const [discoveredImageModels, setDiscoveredImageModels] = useState(() => engine.getDiscoveredModels({ ...state.config, api: "openai-chat", baseUrl: state.config.imageBaseUrl || state.config.baseUrl, apiKey: state.config.imageApiKey || state.config.apiKey }, "image"));
  const [profileName, setProfileName] = useState("");
  const preset = getProviderPreset(form.provider);
  const imageCatalogConfig = { ...form, api: "openai-chat", baseUrl: form.imageBaseUrl || form.baseUrl, apiKey: form.imageApiKey || form.apiKey };
  const modelOptions = buildModelOptions(discoveredModels, engine.getDiscoveredModels(form, "chat"), preset.defaultModels || [], [form.modelId, form.utilityModelId, form.utilityLargeModelId, form.visionModelId]);
  const imageModelOptions = buildModelOptions(discoveredImageModels, engine.getDiscoveredModels(imageCatalogConfig, "image"), preset.defaultImageModels || [], [form.imageModelId]);
  const modelCatalogCount = modelOptions.length;
  const imageCatalogCount = imageModelOptions.length;
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  function chooseProvider(id) {
    const nextPreset = getProviderPreset(id);
    const nextModel = nextPreset.defaultModels?.[0] || "";
    setForm((prev) => ({
      ...prev,
      provider: id,
      api: nextPreset.defaultApi,
      baseUrl: nextPreset.defaultBaseUrl || prev.baseUrl,
      modelId: nextModel || prev.modelId,
      utilityModelId: nextPreset.defaultModels?.[0] || prev.utilityModelId,
      utilityLargeModelId: nextPreset.defaultModels?.[2] || nextPreset.defaultModels?.[1] || prev.utilityLargeModelId,
      visionModelId: nextPreset.defaultModels?.find((model) => /vision|vl|gpt-4o|gemini|grok/i.test(model)) || prev.visionModelId,
      imageModelId: nextPreset.defaultImageModels?.[0] || prev.imageModelId
    }));
    setDiscoveredModels(engine.getDiscoveredModels({ ...form, provider: id, api: nextPreset.defaultApi, baseUrl: nextPreset.defaultBaseUrl || form.baseUrl }, "chat"));
    setDiscoveredImageModels(engine.getDiscoveredModels({ ...form, provider: id, api: "openai-chat", baseUrl: form.imageBaseUrl || nextPreset.defaultBaseUrl || form.baseUrl }, "image"));
  }

  async function save() {
    engine.configure(form);
    toast("配置已保存到手机本地");
    onNavigate("chat");
  }

  async function probe() {
    engine.configure(form);
    setProbing(true);
    try {
      const models = await engine.probeModels();
      setDiscoveredModels(engine.getDiscoveredModels(engine.getState().config, "chat"));
      toast(`模型探测成功：${models.length} 个`);
      if (models[0]?.id) {
        setForm((prev) => {
          const first = models[0]?.id || "";
          const large = models.find((model) => /large|max|pro|sonnet|opus|70b|120b|405b|reasoner/i.test(model.id || model.name || ""))?.id || first;
          const vision = models.find(modelLooksLikeVision)?.id || prev.visionModelId;
          return {
            ...prev,
            modelId: prev.modelId || first,
            utilityModelId: prev.utilityModelId || first,
            utilityLargeModelId: prev.utilityLargeModelId || large,
            visionModelId: prev.visionModelId || vision
          };
        });
      }
    } catch (error) {
      toast(error.message || "模型探测失败");
    } finally {
      setProbing(false);
    }
  }

  async function probeImageModels() {
    engine.configure(form);
    setProbingImages(true);
    try {
      const models = await engine.probeImageModels(form);
      const nextImageConfig = { ...engine.getState().config, api: "openai-chat", baseUrl: form.imageBaseUrl || form.baseUrl, apiKey: form.imageApiKey || form.apiKey };
      setDiscoveredImageModels(engine.getDiscoveredModels(nextImageConfig, "image"));
      toast(`图片模型探测成功：${models.length} 个`);
      if (models[0]?.id) {
        const imageModel = models.find(modelLooksLikeImage)?.id || models[0].id;
        setForm((prev) => ({ ...prev, imageModelId: prev.imageModelId || imageModel }));
      }
    } catch (error) {
      toast(error.message || "图片模型探测失败");
    } finally {
      setProbingImages(false);
    }
  }

  function saveProfile() {
    const profile = engine.upsertConfigProfile({ name: profileName, config: form });
    setProfileName("");
    toast(`配置档已保存：${profile.name}`);
  }

  function applyProfile(id) {
    if (!engine.applyConfigProfile(id)) return;
    setForm(engine.getState().config);
    toast("配置档已切换");
  }

  return (
    <section className="panel config-panel">
      <div className="section-title"><span>AI 设置</span><small>模型分槽 / 多媒体</small></div>
      <div className="sub-panel flush-panel">
        <div className="section-title compact"><span>Provider</span><small>手机直连</small></div>
        <label>Provider</label>
        <select value={form.provider} onChange={(event) => chooseProvider(event.target.value)}>
          {BUILTIN_PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}
        </select>
        <label>协议</label>
        <select value={form.api} onChange={(event) => update("api", event.target.value)}>
          {API_PROTOCOLS.map((api) => <option key={api.id} value={api.id}>{api.label}</option>)}
        </select>
        <label>接口地址</label>
        <input value={form.baseUrl || ""} onChange={(event) => update("baseUrl", event.target.value)} placeholder={preset.defaultBaseUrl || "https://host/v1"} />
        <label>API Key</label>
        <input value={form.apiKey || ""} onChange={(event) => update("apiKey", event.target.value)} type="password" placeholder={preset.authType === "none" ? "这个 provider 可为空" : "保存在手机本地"} />
      </div>
      <div className="sub-panel flush-panel">
        <div className="section-title compact"><span>对话模型</span><small>{modelCatalogCount} 个可选</small></div>
        <div className="model-capsule mobile-model-capsule"><span className="model-capsule-label">Chat</span><ModelPicker label="主聊天模型" value={form.modelId || ""} options={modelOptions} onChange={(id) => update("modelId", id)} placeholder="例如 gpt-4.1-mini / deepseek-chat" hint="对应桌面端当前会话模型" /></div>
        <div className="grid-2">
          <ModelPicker label="小工具模型" value={form.utilityModelId || ""} options={modelOptions} onChange={(id) => update("utilityModelId", id)} placeholder="快速摘要 / 标题 / 轻量任务" hint="utility" />
          <ModelPicker label="大工具模型" value={form.utilityLargeModelId || ""} options={modelOptions} onChange={(id) => update("utilityLargeModelId", id)} placeholder="复杂整理 / 长上下文" hint="utility_large" />
        </div>
        <label>主模型图片能力</label>
        <select value={form.chatImageMode || "unknown"} onChange={(event) => update("chatImageMode", event.target.value)}>
          <option value="unknown">未知，优先使用视觉辅助模型</option>
          <option value="native-image">主模型支持图片输入</option>
          <option value="text-only">主模型仅文本，图片必须走视觉模型</option>
        </select>
        <div className="grid-2">
          <div><label>温度</label><input value={form.temperature ?? 0.7} onChange={(event) => update("temperature", event.target.value)} inputMode="decimal" /></div>
          <div><label>最大输出</label><input value={form.maxTokens ?? 4096} onChange={(event) => update("maxTokens", event.target.value)} inputMode="numeric" /></div>
        </div>
        <label>推理级别</label>
        <select value={form.reasoningLevel || "off"} onChange={(event) => update("reasoningLevel", event.target.value)}>
          <option value="off">关闭</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="xhigh">极高</option>
        </select>
      </div>
      <div className="sub-panel flush-panel">
        <div className="section-title compact"><span>视觉与多媒体</span><small>图片上传 / 生成</small></div>
        <label className="toggle-row"><span>启用视觉辅助模型</span><input type="checkbox" checked={!!form.visionEnabled} onChange={(event) => update("visionEnabled", event.target.checked)} /></label>
        <ModelPicker label="视觉模型" value={form.visionModelId || ""} options={modelOptions} onChange={(id) => update("visionModelId", id)} placeholder="例如 gpt-4o / qwen-vl / grok-vision" hint="带图聊天会优先走这个模型" />
        <ModelPicker label="图片生成模型" value={form.imageModelId || ""} options={imageModelOptions} onChange={(id) => update("imageModelId", id)} placeholder="例如 gpt-image-1 / wanx2.1-t2i-plus" hint={`${imageCatalogCount} 个图片模型候选`} />
        <label>图片生成接口地址</label>
        <input value={form.imageBaseUrl || ""} onChange={(event) => update("imageBaseUrl", event.target.value)} placeholder="默认复用 Provider 接口，可单独填写 OpenAI 兼容 /v1" />
        <label>图片生成 API Key</label>
        <input value={form.imageApiKey || ""} onChange={(event) => update("imageApiKey", event.target.value)} type="password" placeholder="默认复用 Provider API Key" />
        <div className="grid-2">
          <div><label>默认尺寸</label><select value={form.imageSize || "1024x1024"} onChange={(event) => update("imageSize", event.target.value)}><option value="1024x1024">1024x1024</option><option value="1536x1024">1536x1024</option><option value="1024x1536">1024x1536</option><option value="2K">2K</option><option value="4K">4K</option></select></div>
          <div><label>默认比例</label><select value={form.imageAspectRatio || ""} onChange={(event) => update("imageAspectRatio", event.target.value)}><option value="">跟随尺寸</option><option value="1:1">1:1</option><option value="4:3">4:3</option><option value="3:4">3:4</option><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="3:2">3:2</option><option value="2:3">2:3</option><option value="21:9">21:9</option></select></div>
          <div><label>格式</label><select value={form.imageFormat || "png"} onChange={(event) => update("imageFormat", event.target.value)}><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option><option value="auto">Provider 默认</option></select></div>
          <div><label>质量</label><select value={form.imageQuality || "auto"} onChange={(event) => update("imageQuality", event.target.value)}><option value="auto">默认</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></div>
          <div><label>聊天图片数量</label><input value={form.maxImageCount ?? 4} onChange={(event) => update("maxImageCount", event.target.value)} inputMode="numeric" /></div>
          <div><label>单图大小 MB</label><input value={form.maxImageSizeMb ?? 12} onChange={(event) => update("maxImageSizeMb", event.target.value)} inputMode="numeric" /></div>
        </div>
      </div>
      <label>系统提示词 / 人格</label>
      <textarea rows={5} value={form.systemPrompt || ""} onChange={(event) => update("systemPrompt", event.target.value)} placeholder="把桌面端 Agent 人格、约束或技能说明迁移到这里。" />
      <div className="actions"><button className="primary" onClick={save}>保存并进入</button><button onClick={probe} disabled={probing}>{probing ? "探测中" : "探测对话模型"}</button><button onClick={probeImageModels} disabled={probingImages}>{probingImages ? "探测中" : "探测图片模型"}</button><button onClick={() => onNavigate("media")}>图片生成</button></div>
      <div className="sub-panel profile-panel">
        <div className="section-title compact"><span>模型配置档</span><small>{state.snapshot.configProfiles.length} 个</small></div>
        <p className="note">对应桌面端常用 Provider / Model 配置。手机端保存在本地，可一键切换。</p>
        <div className="inline-form">
          <input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="配置档名称，可留空" />
          <button onClick={saveProfile}>保存配置档</button>
        </div>
        <div className="profile-list">
          {state.snapshot.configProfiles.map((profile) => <article className="profile-card" key={profile.id}><div><strong>{profile.name}</strong><small>{profile.config.providerName} / {profile.config.modelId || "未设置模型"}</small></div><div className="card-actions"><button onClick={() => applyProfile(profile.id)}>启用</button><button className="danger ghost" onClick={() => engine.deleteConfigProfile(profile.id)}>删除</button></div></article>)}
          {!state.snapshot.configProfiles.length && <div className="empty compact">暂无配置档</div>}
        </div>
      </div>
    </section>
  );
}

function ChatPage({ state, onNavigate }) {
  const [text, setText] = useState("");
  const [images, setImages] = useState([]);
  const [previewImage, setPreviewImage] = useState(null);
  const listRef = useRef(null);
  const path = state.snapshot.currentSessionPath;
  const messages = path ? (state.snapshot.messagesBySession[path] || []) : [];
  const currentSession = state.snapshot.sessions.find((item) => item.path === path);
  const maxImages = Math.max(1, Math.min(8, Number(state.config.maxImageCount) || 4));
  const maxSizeMb = Math.max(1, Math.min(32, Number(state.config.maxImageSizeMb) || 12));
  const remainingImages = Math.max(0, maxImages - images.length);
  const imageRoute = state.config.chatImageMode === "native-image"
    ? `图片走主模型：${state.config.modelId || "未配置"}`
    : state.config.visionEnabled && state.config.visionModelId
      ? `图片走视觉模型：${state.config.visionModelId}`
      : state.config.chatImageMode === "text-only"
        ? "主模型仅文本，请先配置视觉模型"
        : "图片将尝试走当前模型";

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, state.busy]);

  function addImages(nextImages) {
    setImages((prev) => {
      const merged = [...prev, ...nextImages];
      const seen = new Set();
      return merged.filter((image) => {
        const key = image.id || `${image.name}-${image.size}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, maxImages);
    });
  }

  async function send() {
    const body = text.trim();
    if (!body && !images.length) return;
    try {
      await engine.sendMessage({ text: body, images });
      setText("");
      setImages([]);
    } catch (error) {
      toast(error.message || "发送失败");
    }
  }

  async function pickImages() {
    if (!remainingImages) return toast(`最多附加 ${maxImages} 张图片`);
    try {
      const selected = await chooseImages({ maxCount: remainingImages, maxSizeMb });
      addImages(selected);
    } catch (error) {
      toast(error.message || "图片选择失败");
    }
  }

  async function attachFiles(files) {
    if (!files?.length) return;
    if (!remainingImages) return toast(`最多附加 ${maxImages} 张图片`);
    try {
      const selected = await readImageFiles(Array.from(files).slice(0, remainingImages), { maxSizeMb });
      addImages(selected);
    } catch (error) {
      toast(error.message || "图片读取失败");
    }
  }

  function handlePaste(event) {
    const files = Array.from(event.clipboardData?.files || []).filter((file) => String(file.type || "").startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    attachFiles(files);
  }

  function handleDrop(event) {
    const files = Array.from(event.dataTransfer?.files || []).filter((file) => String(file.type || "").startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    attachFiles(files);
  }

  return (
    <section className="chat-page">
      <div className="panel chat-head"><div><strong>{currentSession?.title || "新对话"}</strong><span>{state.config.providerName} / {state.config.modelId || "未配置模型"}</span><small>{imageRoute}</small></div><button onClick={() => onNavigate("sessions")}>会话</button></div>
      <div className="panel message-list" ref={listRef}>
        {!messages.length && <div className="empty"><b>运行在手机端的 Hanako</b><span>这是 Capacitor Android 独立运行时。配置模型后，手机直接请求 provider，不连接桌面 Server。</span></div>}
        {messages.map((message) => <MessageBubble key={message.id} message={message} onPreview={setPreviewImage} />)}
        {state.busy && <div className="thinking-line">Hanako 正在手机端请求模型...</div>}
      </div>
      {!!images.length && <div className="panel attachment-panel"><div className="attachment-head"><strong>图片附件</strong><span>{images.length}/{maxImages} · 单图 {maxSizeMb}MB · {imageRoute}</span></div><div className="image-strip">{images.map((image) => <article className="attachment-chip" key={image.id}><button className="attachment-thumb" onClick={() => setPreviewImage(image)}><img src={image.src} alt={image.name} /></button><div><strong>{image.name}</strong><small>{image.mimeType} · {formatBytes(image.size)}</small></div><button className="remove-attachment" onClick={() => setImages((prev) => prev.filter((item) => item.id !== image.id))}>移除</button></article>)}</div></div>}
      <div className="panel composer" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}><textarea value={text} onChange={(event) => setText(event.target.value)} onPaste={handlePaste} rows={3} placeholder="输入消息。支持图片预览、上传图片、本地记忆和上下文注入。" /><div className="composer-hint"><span>{images.length ? imageRoute : "可添加图片，Enter 保持换行，点击发送提交"}</span></div><div className="composer-actions"><button onClick={pickImages} disabled={!remainingImages}>图片</button>{!!images.length && <button onClick={() => setImages([])}>清空图片</button>}<button className="primary" onClick={send} disabled={state.busy || (!text.trim() && !images.length)}>发送</button></div></div>
      {previewImage && <ImagePreview image={previewImage} onClose={() => setPreviewImage(null)} />}
    </section>
  );
}

function MessageBubble({ message, onPreview }) {
  return (
    <div className={`message ${message.role}`}>
      <div className="bubble">
        {message.content ? <p>{message.content}</p> : <p className="muted-message">（图片消息）</p>}
        {!!message.images?.length && <div className="message-images">{message.images.map((image) => <button key={image.id} onClick={() => onPreview?.(image)}><img src={image.src} alt={image.name} /></button>)}</div>}
        {message.modelRoute && <small className="message-meta">{message.modelRoute} · {message.modelId}</small>}
      </div>
    </div>
  );
}

function SessionsPage({ state, onNavigate }) {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const sessions = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return state.snapshot.sessions
      .filter((session) => showArchived ? session.archived : !session.archived)
      .filter((session) => !keyword || [session.title, session.summary, session.keywords?.join(" ")].some((field) => String(field || "").toLowerCase().includes(keyword)));
  }, [query, showArchived, state.snapshot.sessions]);
  const archivedCount = state.snapshot.sessions.filter((session) => session.archived).length;
  return (
    <section className="panel sessions-page">
      <div className="section-title"><span>{showArchived ? "归档会话" : "本机会话"}</span><small>{sessions.length} 个{showArchived ? "归档" : "活动"}会话</small></div>
      <div className="actions tight"><button className="primary" onClick={() => { engine.createSession(); onNavigate("chat"); }}>新建对话</button><button onClick={() => engine.startNewSession()}>新对话态</button><button onClick={() => setShowArchived((value) => !value)}>{showArchived ? "活动会话" : `归档 ${archivedCount}`}</button></div>
      <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索本地会话" />
      <div className="session-list">
        {sessions.map((session) => <article key={session.path} className={`session-card${session.archived ? " archived" : ""}`}><div onClick={() => { engine.switchSession(session.path); onNavigate("chat"); }}><strong>{session.title}</strong><p>{session.summary}</p><small>{session.agentName} · {formatRelativeTime(session.modified)}</small>{!!session.keywords?.length && <span>{session.keywords.slice(0, 4).join(" · ")}</span>}</div><div className="card-actions"><button onClick={() => { engine.switchSession(session.path); onNavigate("chat"); }}>打开</button>{session.archived ? <button onClick={() => engine.restoreSession(session.path)}>恢复</button> : <button onClick={() => engine.archiveSession(session.path)}>归档</button>}<button className="danger ghost" onClick={() => window.confirm("删除这个会话？") && engine.deleteSession(session.path)}>删除</button></div></article>)}
        {!sessions.length && <div className="empty compact">暂无会话</div>}
      </div>
    </section>
  );
}

function MemoryPage({ state }) {
  const memory = state.snapshot.memory || [];
  const [draft, setDraft] = useState("");
  function addMemory() {
    const next = engine.upsertMemory(draft, { pinned: true });
    if (!next) return toast("请输入记忆内容");
    setDraft("");
    toast("固定记忆已添加");
  }
  return <section className="panel memory-page"><div className="section-title"><span>手机本地记忆</span><small>{memory.length} 条</small></div><p className="note">对应桌面端记忆能力。手机端支持聊天自动抽取，也支持手动固定关键记忆并注入后续请求。</p><div className="inline-form memory-add"><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="手动添加一条固定记忆" /><button onClick={addMemory}>固定</button></div><div className="actions tight"><button onClick={() => window.confirm("清空所有手机端记忆？") && engine.clearMemory()} disabled={!memory.length}>清空记忆</button></div><div className="memory-list">{memory.slice().sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || String(b.updatedAt).localeCompare(String(a.updatedAt))).map((fact) => <article key={fact.id} className={fact.pinned ? "pinned" : ""}><span>{fact.text}</span><small>{fact.pinned ? "固定记忆" : "自动记忆"} · {formatRelativeTime(fact.updatedAt)}</small><div className="card-actions"><button onClick={() => engine.toggleMemoryPin(fact.id)}>{fact.pinned ? "取消固定" : "固定"}</button><button className="danger ghost" onClick={() => engine.deleteMemory(fact.id)}>删除</button></div></article>)}{!memory.length && <div className="empty compact">暂无记忆，聊天后会自动生成。</div>}</div></section>;
}

function AgentsPage({ state }) {
  const activeId = state.snapshot.activeAgentId;
  const [form, setForm] = useState({ name: "", persona: "", systemPrompt: "" });
  function save() {
    if (!form.name?.trim()) return toast("请输入 Agent 名称");
    engine.upsertAgent(form);
    setForm({ name: "", persona: "", systemPrompt: "" });
    toast("Agent 已保存");
  }
  return <section className="panel agents-page"><div className="section-title"><span>手机 Agent</span><small>{state.snapshot.agents.length} 个本地 Agent</small></div><p className="note">桌面端 Agent 文件夹在手机端适配为本地人格、系统提示词、会话归属和上下文注入。</p><div className="agent-list">{state.snapshot.agents.map((agent) => <article className={`agent-card ${agent.id === activeId ? "active" : ""}`} key={agent.id}><div><strong>{agent.name}</strong><p>{agent.persona || "未设置人格"}</p></div><div className="card-actions"><button onClick={() => engine.switchAgent(agent.id)} disabled={agent.id === activeId}>启用</button><button onClick={() => setForm(agent)}>编辑</button><button className="danger ghost" onClick={() => engine.deleteAgent(agent.id) || toast("至少保留一个 Agent")}>删除</button></div></article>)}</div><div className="sub-panel"><label>名称</label><input value={form.name || ""} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="例如：写作助手" /><label>人格</label><textarea rows={3} value={form.persona || ""} onChange={(event) => setForm((prev) => ({ ...prev, persona: event.target.value }))} /><label>系统提示词</label><textarea rows={4} value={form.systemPrompt || ""} onChange={(event) => setForm((prev) => ({ ...prev, systemPrompt: event.target.value }))} /><div className="actions"><button className="primary" onClick={save}>{form.id ? "保存 Agent" : "新建 Agent"}</button></div></div></section>;
}

function SkillsPage({ state }) {
  const [form, setForm] = useState({ name: "", description: "", prompt: "", enabled: true });
  function save() {
    if (!form.name?.trim() || !form.prompt?.trim()) return toast("请输入技能名称和提示词");
    engine.upsertSkill(form);
    setForm({ name: "", description: "", prompt: "", enabled: true });
    toast("技能已保存并会注入后续对话");
  }
  return <section className="panel skills-page"><div className="section-title"><span>手机 Skills</span><small>{state.snapshot.skills.filter((skill) => skill.enabled).length} 个启用</small></div><p className="note">脚本型 Skills 不在手机 WebView 内直接执行；这里移植为提示词型 Skills，上下文会注入模型。</p><div className="skill-list">{state.snapshot.skills.map((skill) => <article className={`skill-card ${skill.enabled ? "active" : ""}`} key={skill.id}><strong>{skill.name}</strong><p>{skill.description || skill.prompt}</p><div className="card-actions"><button onClick={() => engine.toggleSkill(skill.id)}>{skill.enabled ? "停用" : "启用"}</button><button onClick={() => setForm(skill)}>编辑</button><button className="danger ghost" onClick={() => engine.deleteSkill(skill.id)}>删除</button></div></article>)}</div><div className="sub-panel"><label>技能名称</label><input value={form.name || ""} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} /><label>说明</label><input value={form.description || ""} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} /><label>注入提示词</label><textarea rows={5} value={form.prompt || ""} onChange={(event) => setForm((prev) => ({ ...prev, prompt: event.target.value }))} /><div className="actions"><button className="primary" onClick={save}>{form.id ? "保存技能" : "新增技能"}</button></div></div></section>;
}

function DeskPage({ state }) {
  const [note, setNote] = useState({ title: "", body: "" });
  const [url, setUrl] = useState("");
  const [clipping, setClipping] = useState(false);
  const [preview, setPreview] = useState(null);
  function addNote() {
    if (!note.title.trim() && !note.body.trim()) return toast("请输入书桌内容");
    engine.upsertDeskItem({ type: "note", title: note.title || "手机便签", body: note.body, pinned: true });
    setNote({ title: "", body: "" });
    toast("已加入手机书桌");
  }
  async function addImage() {
    try {
      const image = (await chooseImages({ maxCount: 1 }))[0];
      if (!image) return;
      engine.upsertDeskItem({ type: "image", title: image.name, body: `图片资料：${image.name}`, mediaSrc: image.src, mimeType: image.mimeType, pinned: true });
      toast("图片已加入书桌");
    } catch (error) { toast(error.message || "图片加入失败"); }
  }
  async function clip() {
    setClipping(true);
    try { await engine.clipUrl(url); setUrl(""); toast("网页摘录已加入书桌"); }
    catch (error) { toast(error.message || "网页摘录失败"); }
    finally { setClipping(false); }
  }
  return <section className="panel desk-page"><div className="section-title"><span>手机书桌</span><small>{state.snapshot.desk.filter((item) => item.pinned).length} 个已置顶</small></div><p className="note">桌面书桌适配为手机资料夹：便签、网页摘录、图片资料可置顶并注入对话。</p><div className="sub-panel"><label>便签标题</label><input value={note.title} onChange={(event) => setNote((prev) => ({ ...prev, title: event.target.value }))} /><label>便签内容</label><textarea rows={4} value={note.body} onChange={(event) => setNote((prev) => ({ ...prev, body: event.target.value }))} /><div className="actions"><button className="primary" onClick={addNote}>保存便签</button><button onClick={addImage}>加入图片</button></div></div><div className="sub-panel"><label>网页摘录 URL</label><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/article" /><div className="actions"><button onClick={clip} disabled={clipping}>{clipping ? "摘录中" : "抓取到书桌"}</button></div></div><div className="desk-list">{state.snapshot.desk.map((item) => <article className={`desk-card ${item.pinned ? "active" : ""}`} key={item.id}>{item.mediaSrc && <img src={item.mediaSrc} alt={item.title} onClick={() => setPreview(item)} />}<div><strong>{item.title}</strong><small>{item.type}{item.sourceUrl ? ` · ${item.sourceUrl}` : ""}</small><p>{item.body}</p></div><div className="card-actions"><button onClick={() => engine.toggleDeskPin(item.id)}>{item.pinned ? "取消置顶" : "置顶"}</button><button className="danger ghost" onClick={() => engine.deleteDeskItem(item.id)}>删除</button></div></article>)}{!state.snapshot.desk.length && <div className="empty compact">暂无书桌资料</div>}</div>{preview && <div className="media-viewer" onClick={() => setPreview(null)}><img src={preview.mediaSrc} alt={preview.title} /><span>{preview.title}</span></div>}</section>;
}

function ImagePreview({ image, onClose }) {
  if (!image) return null;
  return <div className="media-viewer" onClick={onClose}><div className="media-viewer-card" onClick={(event) => event.stopPropagation()}><img src={image.src || image.mediaSrc} alt={image.name || image.title} /><div><strong>{image.name || image.title}</strong><span>{image.mimeType || "image"}{image.size ? ` · ${formatBytes(image.size)}` : ""}</span></div><button onClick={onClose}>关闭</button></div></div>;
}

function MediaPage({ state, onNavigate }) {
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState(() => ({
    modelId: state.config.imageModelId || "",
    size: state.config.imageSize || "1024x1024",
    aspectRatio: state.config.imageAspectRatio || "",
    format: state.config.imageFormat || "png",
    quality: state.config.imageQuality || "auto"
  }));
  const [result, setResult] = useState(null);
  const [generating, setGenerating] = useState(false);
  const preset = getProviderPreset(state.config.provider);
  const imageCatalogConfig = { ...state.config, api: "openai-chat", baseUrl: state.config.imageBaseUrl || state.config.baseUrl, apiKey: state.config.imageApiKey || state.config.apiKey };
  const imageModelOptions = buildModelOptions(engine.getDiscoveredModels(imageCatalogConfig, "image"), preset.defaultImageModels || [], [state.config.imageModelId, options.modelId]);

  useEffect(() => {
    setOptions((prev) => ({
      modelId: prev.modelId || state.config.imageModelId || "",
      size: prev.size || state.config.imageSize || "1024x1024",
      aspectRatio: prev.aspectRatio ?? state.config.imageAspectRatio ?? "",
      format: prev.format || state.config.imageFormat || "png",
      quality: prev.quality || state.config.imageQuality || "auto"
    }));
  }, [state.config.imageAspectRatio, state.config.imageFormat, state.config.imageModelId, state.config.imageQuality, state.config.imageSize]);

  function updateOption(key, value) {
    setOptions((prev) => ({ ...prev, [key]: value }));
  }

  function saveDefaults() {
    engine.configure({
      ...state.config,
      imageModelId: options.modelId,
      imageSize: options.size,
      imageAspectRatio: options.aspectRatio,
      imageFormat: options.format,
      imageQuality: options.quality
    });
    toast("图片生成默认参数已保存");
  }

  async function submit() {
    if (!prompt.trim()) return toast("请输入图片生成提示词");
    setGenerating(true);
    try {
      const generated = await engine.createImage({ prompt, options });
      setResult(generated);
      toast("图片已生成并保存到手机书桌");
    } catch (error) {
      toast(error.message || "图片生成失败");
    } finally {
      setGenerating(false);
    }
  }

  return <section className="panel media-page"><div className="section-title"><span>多媒体</span><small>图片生成 / 图片模型</small></div><p className="note">对齐桌面端媒体设置：手机端直接调用 OpenAI 兼容图片生成接口，生成结果会保存到手机书桌。音频、视频和插件队列不依赖桌面 Server 时暂不等价启用。</p><div className="media-hero"><div><strong>{state.config.providerName}</strong><span>{options.modelId || "未设置图片生成模型"}</span></div><button onClick={() => onNavigate("config")}>AI 设置</button></div><ModelPicker label="图片生成模型" value={options.modelId} options={imageModelOptions} onChange={(id) => updateOption("modelId", id)} placeholder="例如 gpt-image-1 / wanx2.1-t2i-plus" hint="从 AI 设置探测到的真实图片模型列表中选择" /><label>提示词</label><textarea rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述画面、风格、构图、光线和比例。" /><div className="grid-2"><div><label>尺寸</label><select value={options.size} onChange={(event) => updateOption("size", event.target.value)}><option value="1024x1024">1024x1024</option><option value="1536x1024">1536x1024</option><option value="1024x1536">1024x1536</option><option value="2K">2K</option><option value="4K">4K</option></select></div><div><label>比例</label><select value={options.aspectRatio} onChange={(event) => updateOption("aspectRatio", event.target.value)}><option value="">跟随尺寸</option><option value="1:1">1:1</option><option value="4:3">4:3</option><option value="3:4">3:4</option><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="3:2">3:2</option><option value="2:3">2:3</option><option value="21:9">21:9</option></select></div><div><label>格式</label><select value={options.format} onChange={(event) => updateOption("format", event.target.value)}><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option><option value="auto">Provider 默认</option></select></div><div><label>质量</label><select value={options.quality} onChange={(event) => updateOption("quality", event.target.value)}><option value="auto">默认</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></div></div><div className="actions"><button className="primary" onClick={submit} disabled={generating || state.busy}>{generating ? "生成中" : "生成图片"}</button><button onClick={saveDefaults}>保存为默认</button><button onClick={() => onNavigate("desk")}>打开书桌</button></div>{result && <div className="generated-card"><img src={result.src} alt="生成图片" /><div><strong>{result.deskItem?.title || "生成图片"}</strong><p>{result.revisedPrompt || prompt}</p><small>{options.modelId} · {options.size}{options.aspectRatio ? ` · ${options.aspectRatio}` : ""}</small></div></div>}</section>;
}

function TasksPage({ state }) {
  const [form, setForm] = useState({ title: "", detail: "", dueAt: "" });
  const tasks = state.snapshot.tasks.slice().sort((a, b) => String(a.dueAt || "9999").localeCompare(String(b.dueAt || "9999")));
  function save() {
    if (!form.title.trim()) return toast("请输入任务标题");
    engine.upsertTask(form);
    setForm({ title: "", detail: "", dueAt: "" });
    toast("任务已保存。App 前台运行时会提示到期任务。");
  }
  return <section className="panel tasks-page"><div className="section-title"><span>前台任务</span><small>{tasks.filter((task) => !task.done).length} 个未完成</small></div><p className="note">桌面 Cron/心跳适配为手机前台任务。可靠后台提醒需要后续 Android WorkManager 原生模块。</p><div className="sub-panel"><label>任务标题</label><input value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} /><label>详情</label><textarea rows={3} value={form.detail} onChange={(event) => setForm((prev) => ({ ...prev, detail: event.target.value }))} /><label>到期时间</label><input type="datetime-local" value={form.dueAt} onChange={(event) => setForm((prev) => ({ ...prev, dueAt: event.target.value }))} /><div className="actions"><button className="primary" onClick={save}>{form.id ? "保存任务" : "新增任务"}</button></div></div><div className="task-list">{tasks.map((task) => <article className={`task-card ${task.done ? "done" : ""}`} key={task.id}><div><strong>{task.title}</strong><p>{task.detail || "无详情"}</p><small>{task.dueAt ? `到期：${task.dueAt}` : "未设置时间"}</small></div><div className="card-actions"><button onClick={() => engine.toggleTask(task.id)}>{task.done ? "恢复" : "完成"}</button><button onClick={() => setForm(task)}>编辑</button><button className="danger ghost" onClick={() => engine.deleteTask(task.id)}>删除</button></div></article>)}{!tasks.length && <div className="empty compact">暂无任务</div>}</div></section>;
}

function CompatibilityPage({ state }) {
  async function exportData() {
    try {
      await downloadText("hanako-capacitor-android-export.json", JSON.stringify(engine.exportPortableData(), null, 2));
      toast("导出文件已交给 Android 分享面板");
    } catch (error) {
      toast(error.message || "导出失败");
    }
  }
  async function importData(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try { engine.importPortableData(JSON.parse(await readTextFile(file))); toast("导入完成"); }
    catch (error) { toast(error.message || "导入失败"); }
    finally { event.target.value = ""; }
  }
  return <section className="panel compatibility-page"><div className="section-title"><span>移植兼容矩阵</span><small>Capacitor Android</small></div><div className="capability-list">{state.capabilities.map((item) => <article key={item.key} className={`capability ${item.status}`}><strong>{item.label}</strong><em>{item.status}</em><p>{item.detail}</p></article>)}</div><div className="danger-zone"><button onClick={exportData}>导出手机端数据</button><label className="file-button">导入数据<input type="file" accept="application/json" onChange={importData} /></label><button className="danger" onClick={() => window.confirm("清空本地会话和记忆？") && engine.clearLocalData({ keepConfig: true })}>清空会话/记忆</button></div></section>;
}

function ContextPage({ state, onNavigate }) {
  const summary = state.contextSummary || engine.getContextSummary();
  const pinnedDesk = state.snapshot.desk.filter((item) => item.pinned);
  const enabledSkills = state.snapshot.skills.filter((skill) => skill.enabled);
  const openTasks = state.snapshot.tasks.filter((task) => !task.done);
  const pinnedMemory = state.snapshot.memory.filter((item) => item.pinned);
  return <section className="panel context-page"><div className="section-title"><span>上下文中心</span><small>约 {summary.estimatedTokens} tokens</small></div><p className="note">对齐桌面端“书桌 / 记忆 / 技能 / 任务”注入思路。这里显示下一次模型请求会带入的手机端上下文。</p><div className="context-meter"><div><strong>{summary.messageCount}</strong><span>消息</span></div><div><strong>{summary.imageCount}</strong><span>图片</span></div><div><strong>{summary.characterCount}</strong><span>字符</span></div><div><strong>{summary.estimatedTokens}</strong><span>估算 token</span></div></div><div className="context-sections">{summary.sections.map((section) => <article key={section.key}><div><strong>{section.label}</strong><small>{section.count} 项</small></div><p>{section.detail}</p></article>)}</div><div className="sub-panel"><div className="section-title compact"><span>快速管理</span><small>注入来源</small></div><div className="more-grid"><button onClick={() => onNavigate("agents")}>Agent</button><button onClick={() => onNavigate("skills")}>Skills</button><button onClick={() => onNavigate("desk")}>书桌</button><button onClick={() => onNavigate("tasks")}>任务</button><button onClick={() => onNavigate("memory")}>记忆</button><button onClick={() => onNavigate("config")}>模型</button></div></div><div className="context-preview"><article><strong>置顶书桌</strong><p>{pinnedDesk.map((item) => item.title).join(" / ") || "无"}</p></article><article><strong>启用 Skills</strong><p>{enabledSkills.map((item) => item.name).join(" / ") || "无"}</p></article><article><strong>开放任务</strong><p>{openTasks.map((item) => item.title).join(" / ") || "无"}</p></article><article><strong>固定记忆</strong><p>{pinnedMemory.map((item) => item.text).join(" / ") || "无"}</p></article></div></section>;
}

function MorePage({ state, onNavigate }) {
  return <section className="panel more-page"><div className="section-title"><span>更多桌面功能</span><small>手机适配入口</small></div><div className="more-grid"><button onClick={() => onNavigate("sessions")}>会话历史</button><button onClick={() => onNavigate("memory")}>本地记忆</button><button onClick={() => onNavigate("context")}>上下文中心</button><button onClick={() => onNavigate("media")}>多媒体</button><button onClick={() => onNavigate("tasks")}>前台任务</button><button onClick={() => onNavigate("compat")}>迁移矩阵</button><button onClick={() => onNavigate("config")}>模型配置</button><button onClick={() => onNavigate("desk")}>手机书桌</button></div><CompatibilityPage state={state} /></section>;
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsText(file, "utf-8");
  });
}

function App() {
  const state = useEngineState();
  const [tab, setTab] = useState(state.configured ? "chat" : "config");
  const [showSplash, setShowSplash] = useState(true);
  useEffect(() => { if (!state.configured && tab === "chat") setTab("config"); }, [state.configured, tab]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const due = engine.getDueTasks();
      if (due.length) toast(`有 ${due.length} 个前台任务已到期`);
    }, 60_000);
    const due = engine.getDueTasks();
    if (due.length) window.setTimeout(() => toast(`有 ${due.length} 个前台任务已到期`), 600);
    return () => window.clearInterval(timer);
  }, []);

  const page = tab === "config" ? <ConfigPage state={state} onNavigate={setTab} />
    : tab === "sessions" ? <SessionsPage state={state} onNavigate={setTab} />
    : tab === "memory" ? <MemoryPage state={state} />
    : tab === "agents" ? <AgentsPage state={state} />
    : tab === "skills" ? <SkillsPage state={state} />
    : tab === "desk" ? <DeskPage state={state} />
    : tab === "media" ? <MediaPage state={state} onNavigate={setTab} />
    : tab === "tasks" ? <TasksPage state={state} />
    : tab === "context" ? <ContextPage state={state} onNavigate={setTab} />
    : tab === "compat" ? <CompatibilityPage state={state} />
    : tab === "more" ? <MorePage state={state} onNavigate={setTab} />
    : <ChatPage state={state} onNavigate={setTab} />;

  return (
    <>
      <main className="app-shell" aria-hidden={showSplash ? "true" : undefined}>
        {page}
        <nav className="bottom-tabs">
          <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>聊天</button>
          <button className={tab === "agents" ? "active" : ""} onClick={() => setTab("agents")}>Agent</button>
          <button className={tab === "desk" ? "active" : ""} onClick={() => setTab("desk")}>书桌</button>
          <button className={tab === "media" ? "active" : ""} onClick={() => setTab("media")}>媒体</button>
          <button className={tab === "skills" ? "active" : ""} onClick={() => setTab("skills")}>技能</button>
          <button className={tab === "config" ? "active" : ""} onClick={() => setTab("config")}>配置</button>
          <button className={tab === "more" ? "active" : ""} onClick={() => setTab("more")}>更多</button>
        </nav>
        <ToastHost />
      </main>
      {showSplash && <MobileSplash onDone={() => setShowSplash(false)} />}
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
