<p align="center">
  <img src=".github/assets/banner.jpg" width="100%" alt="OpenHanako Banner">
</p>

<p align="center">
  <img src=".github/assets/Hanako-280.png" width="80" alt="Hanako">
</p>

<h1 align="center">OpenHanako</h1>

<p align="center">一个有记忆、有灵魂的私人 AI 助理</p>

<p align="center"><a href="README_EN.md">English</a></p>

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)](https://github.com/KSKOOO/openhanako-forlinux/releases)

---

## 这个 Fork 提供什么

这个仓库基于 OpenHanako 做了面向日常分发的补充，当前重点是：

- Linux 桌面版重新打包，提供 `.deb`、`.tar.gz` 和 `.AppImage`
- Linux 启动兼容性修正，包括图标、桌面启动器和 Chromium 沙盒回退逻辑
- Android 独立移植工程，使用 React/Vite + Capacitor，手机端直接运行本地运行时
- Android 侧已移植模型直连、Provider 兼容、会话、记忆、Agent、Skills、书桌、任务和图片输入

如果你只想下载现成包，优先看本仓库的 [Releases](https://github.com/KSKOOO/openhanako-forlinux/releases)。

## Hanako 是什么

OpenHanako 是一个更加易用的 AI agent，有记忆，有性格，会主动行动，还能多 Agent 在你的电脑上一同工作。

作为助手，Ta 是温柔的：不需要写复杂的配置，不需要理解晦涩的术语。Hanako 它不只面向 coder ，而是为每一个坐在电脑前工作的人设计的助手。
作为工具，Ta 是强大的：记住你说过的每一件事，操作你的电脑，浏览网页，搜索信息，读写文件，执行代码，管理日程，还能自主学习新技能。

我开这个项目的初衷是：弥合绝大多数人和 AI Agent 之间的缝隙，让强大的 Agent 能力不再只局限于命令行里。于是我做了比传统 Coding Agent 更多一些的优化：一方面是强化 Agent「像人」的属性，是你和他们沟通更自然；另一方面，因为我本职也是一介文员，所以我也针对日常办公场景做了很多工具性和流程性的优化，敬请探索。
此外，Hanako 有比较完备的图形页面。

如果你用过 claude code、codex、Manus 等 CLI 或是图形化的 Agent，你会在 Hanako 这里找到熟悉又新奇的感觉。

## 功能特性

**记忆** — 结合主流的记忆方案，自己又发挥了一下，做了个记忆系统，近期的事情记得非常牢固，但目前确实有待优化。

**人格** — 不是千篇一律的"AI 助手"。通过人格模板和自定义人格文件塑造独特的性格，每个 Agent 都有自己的说话方式和行为逻辑，Agent 之间分离做得很好，备份方便，Agent 就是文件夹，后续还会添加备份功能。

**工具** — 读写文件、执行终端命令、浏览网页、通过浏览器后端或 API 搜索互联网、截图、媒体预览、检查网页。能力覆盖日常办公的绝大多数场景。

**SKILLS 支持** — 内置兼容庞大 SKILLS 社区生态，之外，我也做了一些主动的优化：有时候干活之前，Agent 会从 GitHub 安装社区技能，Agent 也可以自己编写并学会新技能，有比较不错的主动性。当然，默认情况给 Agent 做了比较严格的 SKILLS 审核，如果发现 SKILLS 装不上可以自行关闭。

**多 Agent** — 创建多个 Agent，各自有独立的记忆、人格和定时任务。Agent 之间可以通过频道群聊协作，也可以互相委派任务。

**书桌** — 每个 Agent 都有自己的书桌，可以放文件、写笺（类似便签，Agent 会主动读取并执行）。支持拖拽操作，文件预览，是你和 Agent 之间的异步协作空间。

**全屏媒体查看器** — 聊天里或书桌上的任意图片、SVG、视频，点开就是暗色遮罩的全屏预览：滚轮缩放、拖拽平移，`+` / `−` / `0` 键盘快捷，左右箭头在同会话或同目录的相邻媒体间切换。

**定时任务与心跳** — Agent 可以设置定时任务（Cron），也会定期巡检书桌上的文件变化。你不在的时候，Ta 也能按计划自主工作。

**安全沙盒** — 双层隔离：应用层 PathGuard 四级访问控制 + 操作系统级沙盒（macOS Seatbelt / Linux Bubblewrap）。Agent 的权限在你的掌控之中。平时只能访问工作目录和一些用户文件，如果你想调整权限，可以在设置 → 安全页面修改沙盒级别。

**插件系统** — 约定优先的可扩展插件架构。拖拽安装社区插件，插件可以贡献工具、技能、命令、Agent 模板、HTTP 路由、事件钩子、LLM Provider、页面、侧栏 Widget、配置 schema 和后台任务。路由可直接访问核心服务（PluginContext 注入），通过 Session Bus 与 Agent 对话、获取历史、管理 session。两级权限模型（restricted / full-access）保障安全。

**多平台接入** — 同一个 Agent 可以同时接入 Telegram、飞书、QQ、微信机器人，在任何平台和 Ta 对话，可以远程操作电脑。

**国际化** — 界面支持中文、英文、日文、韩文、繁体中文 5 种语言。

## 截图

<p align="center">
  <img src=".github/assets/screenshot-main.jpg" width="100%" alt="Hanako 主界面">
</p>

## 快速开始

### 下载安装

**macOS（Apple Silicon / Intel）**：从 [Releases](https://github.com/KSKOOO/openhanako-forlinux/releases) 下载最新 `.dmg`。

应用已通过 Apple Developer ID 签名和公证，macOS 应该可以直接打开。

**Windows**：从 [Releases](https://github.com/KSKOOO/openhanako-forlinux/releases) 下载最新 `.exe` 安装包。

> **Windows SmartScreen 提示：** 安装包暂未经过代码签名，首次运行时 Windows Defender SmartScreen 可能会拦截，点击**更多信息** → **仍要运行**即可，未签名版本的正常现象。

**Linux（x86_64 / amd64 桌面发行版）**：从 [Releases](https://github.com/KSKOOO/openhanako-forlinux/releases) 下载以下任一包：

- `.deb`：推荐给 Debian / Ubuntu / Linux Mint / Zorin OS / KDE neon 等 Debian 系发行版。安装后会注册应用菜单、桌面图标和 `hanako` 启动命令。
- `.AppImage`：单文件便携版，适合不想安装到系统目录的场景。
- `.tar.gz`：解压即用，适合手动分发、二次封装或无 root 权限环境。

常用安装方式：

```bash
# Debian / Ubuntu 系
sudo dpkg -i Hanako-<version>-Linux-amd64.deb
sudo apt-get install -f

# AppImage
chmod +x Hanako-<version>-Linux-x86_64.AppImage
./Hanako-<version>-Linux-x86_64.AppImage

# tar.gz
tar -xzf Hanako-<version>-Linux-x64.tar.gz
cd Hanako-<version>-Linux-x64
./run-hanako.sh
```

### 首次运行

首次启动时，引导向导会带你完成配置：选择语言、输入你的名字、连接模型提供商（API key + base URL），并选择三个模型：**对话模型**（主对话）、**小工具模型**（轻量任务）、**大工具模型**（记忆编译和深度分析）。设置页还可以单独选择**视觉模型**，让文本模型通过 Vision Bridge 处理图片附件。Hanako 支持 OpenAI 兼容、Anthropic 风格、OAuth Provider 和 Ollama 本地模型等多类接入。
目前也添加了 OpenAI 的 OAuth 登录，鉴于 Anthropic 会有封号风险，所以暂时不提供。

## 架构

```
core/           引擎编排层 + Manager（含 PluginManager）
lib/            核心库（记忆、工具、沙盒、Bridge 适配器）
server/         Hono HTTP + WebSocket 服务（独立 Node.js 进程）
hub/            调度器、频道路由、事件总线
desktop/        Electron 应用 + React 前端
shared/         跨层共享工具（config schema、error bus、模型引用等）
plugins/        内置系统插件（随应用打包）
skills2set/     内置技能定义
scripts/        构建工具（server 打包、启动器、签名）
tests/          Vitest 测试
```

引擎层协调多个 Manager（Agent、Session、Model、Preferences、Skill、Channel、BridgeSession、Plugin 等），通过统一的 facade 暴露。Hub 负责后台任务（心跳巡检、定时任务、频道路由、Agent 间通信、DM 路由），独立于当前聊天会话运行。

Server 以独立 Node.js 进程运行（由 Electron spawn 或独立启动），通过 Vite 打包，@vercel/nft 追踪依赖。与 Electron 渲染进程通过 WebSocket 通信。
用户数据目录由 `HANA_HOME` 决定（生产默认 `~/.hanako`，开发默认 `~/.hanako-dev`）。Pi SDK 自己的数据隔离在 `${HANA_HOME}/.pi/` 下。

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面端 | Electron 38 |
| 前端 | React 19 + Zustand 5 + CSS Modules |
| 构建 | Vite 7 |
| 服务端 | Hono + @hono/node-server |
| Agent 运行时 | [Pi SDK](https://github.com/nicepkg/pi) |
| 数据库 | better-sqlite3（WAL 模式） |
| 测试 | Vitest |
| 国际化 | 5 语言（zh / en / ja / ko / zh-TW） |

## 平台支持

| 平台 | 状态 |
|------|------|
| macOS (Apple Silicon) | 已支持（已签名公证） |
| macOS (Intel) | 已支持 |
| Windows | Beta |
| Linux (x86_64 / amd64) | 已支持（`.deb` / `.tar.gz` / `.AppImage`） |
| Android (独立移植 App) | Beta |
| 移动端 (PWA) | 计划中 |

## Android 独立移植 App

仓库包含一个 React/Vite + Capacitor 的 Android 移植工程：[mobile-android/](mobile-android/README.md)。手机端直接连接模型 provider，本地保存会话、记忆、Agent、Skills、书桌和任务，不启动、不连接桌面端 Hanako Server。

- 构建 APK：`npm run mobile:build:apk`
- APK 输出：`dist/mobile-apk/Hanako-Capacitor-Android-0.4.0-debug.apk`
- 无法等价移植的桌面能力见 [Android 功能迁移矩阵](mobile-android/PORTING_MATRIX.md)

## Linux 打包说明

Linux 构建目前面向主流 `x86_64 / amd64` 桌面发行版。推荐优先分发 `.deb` 给 Debian 系发行版，同时保留 `.AppImage` 和 `.tar.gz` 作为通用发布形式。

### 构建环境

```bash
node >= 20
npm >= 10
tar
```

首次构建：

```bash
npm install
```

### 打包命令

```bash
# 只生成 electron-builder 的 linux-unpacked 目录
npm run pack:linux

# 基于 dist/linux-unpacked 重新封装 .deb + .tar.gz
npm run package:linux

# 一步生成 .deb + .tar.gz
npm run dist:linux

# 单独生成 .deb
npm run dist:linux:deb

# 单独生成 .tar.gz
npm run dist:linux:tar

# 单独生成 .AppImage
npm run dist:linux:appimage
```

### 产物说明

- `dist/Hanako-<version>-Linux-amd64.deb`：系统安装包，安装到 `/opt/hanako`，同时写入 `/usr/bin/hanako`、`.desktop` 启动器和 hicolor 图标缓存，适合桌面环境直接使用。
- `dist/Hanako-<version>-Linux-x64.tar.gz`：便携解压包，解压后执行 `./run-hanako.sh` 即可启动 GUI。
- `dist/Hanako-<version>-Linux-x86_64.AppImage`：单文件便携包，适合直接分发；Linux 自动更新仅对 AppImage 生效。
- `dist/linux-unpacked/`：electron-builder 的中间目录，`package:linux` 会基于它重新生成 `.deb` 和 `.tar.gz`。

### 兼容性说明

- `.deb` 包内已包含桌面启动器、菜单图标和 `chrome-sandbox` 权限设置，优先推荐给 Debian / Ubuntu 系桌面系统。
- Linux 启动器会自动检测 `chrome-sandbox`、user namespace 和运行时目录；如果发行版禁用了 Chromium 所需沙盒能力，会自动回退到 `--disable-setuid-sandbox`，必要时再回退到 `--no-sandbox`，避免首次启动直接崩溃。
- `.deb` 和 `.tar.gz` 默认采用手动更新模式；只有 `.AppImage` 运行时才启用 Linux 自动更新。
- 如果是二次打包或重新分发，请保留 `resources/server/`、`chrome-sandbox`、`.desktop` 文件和图标资源，否则会影响 GUI 启动、菜单集成或沙盒兼容性。

## 开发

```bash
# 安装依赖
npm install

# Electron 启动（自动构建 renderer）
npm start

# Vite HMR 开发（需先运行 npm run dev:renderer）
npm run start:vite

# 运行测试
npm test

# 类型检查
npm run typecheck
```

## 许可证

[Apache License 2.0](LICENSE)

## 链接

- [官网](https://openhanako.com)
- [当前仓库 Releases](https://github.com/KSKOOO/openhanako-forlinux/releases)
- [当前仓库 Issues](https://github.com/KSKOOO/openhanako-forlinux/issues)
- [当前仓库 Security](https://github.com/KSKOOO/openhanako-forlinux/security)
- [上游项目](https://github.com/liliMozi/openhanako)
- [安全政策](SECURITY.md)
- [插件开发指南](PLUGINS.md)
- [贡献指南](CONTRIBUTING.md)
