# Android 功能迁移矩阵

| 桌面能力 | 手机端状态 | Android 适配方式 / 原因 |
| --- | --- | --- |
| React/Vite 主界面 | 已移植 | 重新实现手机竖屏 UI，由 Capacitor 加载本地 Vite 产物。 |
| 开屏动画 | 已移植 | 同步桌面端头像、`#F4F0E4` 背景、文案轮播和旋转花形符号。 |
| Provider 配置 | 已移植 | 手机本地保存 provider、协议、base URL、API key、模型名，支持 HTTPS 和局域网 HTTP provider。 |
| 真实模型列表 | 已移植 | 手机端可直接请求 provider `/models`，把真实模型目录缓存到本地，并在桌面式搜索下拉中选择；无列表时仍可手动输入模型 ID。 |
| 大小模型 / 视觉模型 | 已移植 | 手机 AI 设置支持主聊天模型、小工具模型、大工具模型、视觉辅助模型和图片生成模型；配置档会保留这些字段，并可从探测到的真实模型列表选择。 |
| 模型调用 | 已移植 | 支持 OpenAI Chat、OpenAI Responses、Anthropic Messages；Android 原生 HTTP 插件负责跨域和网络请求，Manifest 已允许明文局域网访问。 |
| Provider 兼容层 | 已移植 | Qwen thinking、DeepSeek reasoning、Anthropic headers 等关键兼容逻辑在手机端实现。 |
| 会话历史 | 已移植 | 使用手机 localStorage 保存会话、消息、摘要、关键词、归档状态，支持恢复和删除。 |
| 记忆 | 部分移植 | 桌面记忆编译器依赖文件系统和后台进程；手机端实现轻量消息摘要记忆、手动固定记忆、删除和清空。 |
| 上下文中心 | 已移植 | 手机端展示 Agent、Skills、书桌、任务、记忆和消息上下文，并估算 token 规模。 |
| 模型配置档 | 已移植 | 常用 provider / model / system prompt 组合可保存为本地配置档并一键切换。 |
| 多 Agent | 部分移植 | 桌面 Agent 文件夹适配为手机本地人格、系统提示词和会话归属。 |
| Skills | 部分移植 | 提示词型 Skills 已移植；脚本型 Skills 依赖 Node/Shell/文件系统，手机 WebView 内不能直接执行。 |
| 书桌 | 部分移植 | 便签、网页摘录、图片资料和置顶上下文已移植；任意桌面文件夹监听不可用。 |
| 图片输入 / 数据导出 | 已移植 | 使用系统文件选择器、粘贴或拖入读取图片并转 base64；聊天框支持图片预览、移除、数量和大小限制。导出通过 Capacitor Filesystem 写入缓存并调用 Android 分享面板。 |
| 图片视觉路由 | 已移植 | 对齐桌面端输入区的图片预检思路：主模型可标记为支持图片、纯文本或未知；纯文本或启用视觉辅助时，带图消息改用视觉模型。 |
| 图片生成 | 部分移植 | 已实现 OpenAI 兼容 `/images/generations` 直连、模型选择、尺寸、比例、格式和质量设置，并将生成结果保存到书桌；桌面插件的异步任务队列、provider 专用复杂适配和图生图仍未等价移植。 |
| 音频 / 视频多媒体 | 未等价移植 | 桌面 image-gen 插件已有部分媒体生成适配，但手机端目前没有插件进程、后台任务队列和统一媒体文件落盘管线，需要后续 Capacitor 原生模块补齐。 |
| Cron / 心跳 | 部分移植 | 当前实现前台任务和打开 App 时提醒；可靠后台调度需要后续 WorkManager 原生模块。 |
| 插件系统 | 未等价移植 | 桌面插件可贡献 Node 路由、工具和后台任务，手机端无法安全执行任意插件代码。 |
| Shell / PTY | 不可移植 | Android App 沙盒不提供桌面终端和任意 shell 执行能力。 |
| 任意文件系统访问 | 不可移植 | Android 受 scoped storage 限制，只能通过系统选择器或 App 私有目录访问文件。 |
| Electron IPC / 桌面窗口 | 不可移植 | Capacitor Android 没有 Electron 主进程、BrowserWindow 或 IPC。 |
| 电脑控制 / 截屏自动化 | 不可移植 | 桌面 OS 自动化能力不能直接映射到普通 Android App。 |
