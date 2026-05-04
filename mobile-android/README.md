# Hanako Capacitor Android

这是 OpenHanako 的 Android 独立移植工程，使用 React/Vite + Capacitor 承载手机端运行时。APK 在手机上直接运行，不启动桌面 Server，也不连接桌面 API。

## 架构

- `src/`：手机端 React UI、本地 Hanako 运行时、provider 兼容层和本地数据管理。
- `android/`：Capacitor 生成的 Android 工程，包含 `HanakoHttpPlugin` 原生 HTTP 插件。
- `capacitor.config.json`：Capacitor 应用配置和启动页配置。
- `dist/`：Vite 构建产物，由 `cap sync android` 同步到 Android assets。

## 已移植能力

- Provider 配置和模型直连：OpenAI Chat、OpenAI Responses、Anthropic Messages，以及常见 OpenAI 兼容 provider。
- 手机本地会话：创建、切换、搜索、摘要、关键词。
- 手机本地会话：创建、切换、搜索、摘要、关键词、归档、恢复和删除。
- 手机本地记忆：从近期用户消息抽取轻量记忆，支持手动固定记忆、删除和清空，并注入后续请求。
- 上下文中心：展示 Agent、Skills、书桌、任务、记忆和消息上下文的注入来源，并估算上下文 tokens。
- 手机 Agent：人格、系统提示词、会话归属和上下文注入。
- 手机 Skills：提示词型技能启用、停用和上下文注入。
- 手机书桌：便签、网页摘录、图片资料、置顶上下文和图片预览。
- 前台任务：任务列表和 App 打开时到期提醒。
- 模型配置档：保存常用 provider / model / system prompt 组合并一键切换。
- AI 设置模型分槽：支持主聊天模型、小工具模型、大工具模型、视觉辅助模型和图片生成模型，配置结构对齐桌面端 `utility`、`utility_large`、`vision` 和媒体默认模型思路。
- 真实模型列表：填写 Provider API 后可探测 `/models`，模型目录会缓存到手机本地；主模型、小模型、大模型、视觉模型和图片生成模型都支持桌面式搜索下拉选择，也保留手动输入模型 ID。
- 多媒体设置：支持图片生成模型、尺寸、比例、格式、质量、聊天图片数量和单图大小限制。
- 图片输入：通过系统文件选择器、粘贴或拖入读取图片，聊天框支持缩略图、文件名、大小、移除、全屏预览和发送前图片能力路由。
- 视觉辅助模型：当主模型标记为纯文本或用户启用视觉辅助模型时，带图消息会改用视觉模型请求，避免把图片误发给文本模型。
- 图片生成：手机端直接调用 OpenAI 兼容 `/images/generations` 接口，生成结果自动保存到手机书桌。
- 数据导入导出：Android 端配置、会话、记忆和资料 JSON，导出通过系统分享面板交给文件管理器或聊天应用。
- 局域网模型服务：Android Manifest 已允许明文 HTTP，便于直连手机同网段的 Ollama / OpenAI 兼容服务。
- 开屏动画：同步桌面端 Hanako 头像、米色背景、文案轮播和旋转花形符号。
- 界面主题：手机端同步桌面默认 `warm-paper` 主题的米色纸面、青蓝 accent 和文字层级。
- 按钮和控件：同步桌面端 warm-paper 的方圆按钮、边框按钮、主按钮和输入框视觉语言，同时保留手机触控尺寸。
- 屏幕方向：Android Activity 锁定竖屏，优先保证手机单手使用布局。

## 构建

```bash
npm run mobile:install
npm run mobile:build:apk
```

输出：

```text
dist/mobile-apk/Hanako-Capacitor-Android-0.4.0-debug.apk
```

只构建 H5：

```bash
npm run mobile:build
```

同步 Android 工程：

```bash
npm run mobile:sync
```

## 限制

手机端不是桌面 OS。Electron IPC、PTY/Shell、任意文件系统、电脑控制、桌面沙盒、Node 插件执行、桌面后台常驻进程不能在纯手机端等价运行。对应说明见 [PORTING_MATRIX.md](PORTING_MATRIX.md)。

图片生成接口沿用桌面端 image-gen 插件的 OpenAI 兼容主路径，但不加载桌面插件进程。不同 provider 的图片接口字段差异较大，手机端会在 `output_format`、`aspect_ratio` 等可选字段报错时做一次降级重试；非 OpenAI 兼容的异步任务、音频和视频生成仍需后续原生适配。
