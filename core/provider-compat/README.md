# Provider 兼容层规范

> 本目录是 hana 唯一的 provider-specific payload 兼容层。
> 任何按 provider 走分支的代码都必须遵守本文件规则。

## 核心纪律

1. **唯一对外入口**：所有出站 payload 兼容必须经过 [`core/provider-compat.js`](../provider-compat.js) 的 `normalizeProviderPayload(payload, model, options)`。chat 路径（`engine.js` 注册的 `before_provider_request` 钩子）和 utility 路径（`llm-client.js` 的 `callText`）共享这一个入口。需要在 provider serializer 之前处理的 replay/history 规则走同文件的 `normalizeProviderContextMessages(messages, model, options)`。
2. **通用补丁留主入口**：与 provider 无关的处理（空 tools 数组剥离、按 `compat.thinkingFormat` 剥离不兼容的 `thinking` 字段）写在 `provider-compat.js` 主入口。
3. **Provider-specific 补丁拆子文件**：每个 provider 一个 `core/provider-compat/<name>.js`，互不串扰。
4. **接口契约**：每个子文件 export `matches(model) → boolean`（必须容忍 `model = null/undefined`，不抛错）和 `apply(payload, model, options) → payload`（不可 mutate 输入 payload）。如果该 provider 有 serializer 前的 replay/history 约束，可以额外 export `normalizeContextMessages(messages, model, options) → messages`。
5. **dispatch 单调性**：dispatcher 按数组顺序遍历，第一个 `matches` 返回 true 的子模块负责处理（first-match-wins）。一个 model 只匹配一个子模块。新 provider 默认加在数组末尾；只有当模块的 `matches` 是另一模块的子集（更具体的规则）时才前置，避免被通用规则吞掉。
6. **禁止散落**：调用点（`callText`、`engine.js` 钩子、route handler 等）禁止内联 provider-specific 补丁。一旦发现，迁移到本目录。

## 新增 provider 补丁的步骤

1. 在 `core/provider-compat/` 下新建 `<provider>.js`
2. 文件顶部 JSDoc 注释必须写明：
   - 处理的 provider（`provider` 字段值或 baseUrl 模式）
   - 解决的具体协议问题（链接到官方文档）
   - **删除条件**（即什么情况下整个文件可整块删掉）
3. export `matches(model)` 和 `apply(payload, model, options)`，签名见下文
4. 在 `core/provider-compat.js` 的 `PROVIDER_MODULES` 数组末尾加入 import
5. 在 `tests/provider-compat/<provider>.test.js` 加测试：
   - `matches` 真值表（正例 / 反例 / `model=null`）
   - `apply` 在 `mode: "chat"` 和 `mode: "utility"` 两种上下文的行为
   - 不可变性断言（apply 不 mutate 输入 payload）

## 升级 SDK 时的检查清单

升级 `@mariozechner/pi-coding-agent` 或 `@mariozechner/pi-ai` 后必须执行：

1. 跑 `npm test` 全套，重点关注 `tests/provider-compat.test.js` 和 `tests/provider-compat/*.test.js`
2. 检查每个 `provider-compat/*.js` 顶部的"删除条件"，对照 SDK 升级 changelog 看是否还需要保留
3. 如果某个 provider 子模块的删除条件已满足（SDK 升级后官方一等公民化），删除该文件并从 `PROVIDER_MODULES` 移除 import
4. 如果 SDK 改了 `convertMessages` 后的 assistant payload 形态（尤其是 `message.content` 字符串 / 数组边界，影响 `deepseek.js` 的 `extractReasoningFromContent`），更新 extract 逻辑和 `tests/acceptance-issue-468.test.js` 的真实转换场景

## 接口契约

### `matches(model) → boolean`

```js
/**
 * 判断本模块是否处理这个 model。
 *
 * 实现要求：
 *   - 纯函数，无副作用
 *   - 优先用 provider / baseUrl / quirks / compat.thinkingFormat 等数据声明字段，避免按 model.id 字符串硬匹配
 *   - 必须容忍字段缺失：遇到 model = null/undefined 或目标字段不存在时返回 false，
 *     不抛错（dispatcher 不能因为某个子模块的 matches 崩溃影响其他模块）
 *   - 不可依赖 `this`：dispatcher 通过 `import * as mod` 的 namespace object 调用，
 *     namespace 是 frozen 的且无 `this` 上下文。matches 与 apply 都必须是顶层导出的独立函数
 */
export function matches(model) { ... }
```

### `apply(payload, model, options) → payload`

```js
/**
 * 对 payload 应用本 provider 的全部兼容补丁。
 *
 * 实现要求：
 *   - 不可变契约：返回新对象（或原对象，未修改时）；不直接 mutate 调用方传入的 payload
 *   - 必须能处理 mode: "chat" 和 mode: "utility" 两种调用上下文
 *   - 必须能容忍 model 字段缺失（保守处理，宁可不补也别错补）
 *   - `options` 字段是开放扩展的：dispatcher 把调用方传入的整个 options 透传给所有子模块；子模块按需读取自己关心的字段，未识别的字段必须忽略，不报错
 */
export function apply(payload, model, options) { ... }
```

## Thinking 格式声明

`reasoning` 只表示模型具备思考能力，不表示请求体该使用哪种字段。
请求侧思考控制统一由 `model.compat.thinkingFormat` 表示：

| 值 | 请求体格式 | 例子 |
|---|---|---|
| `anthropic` | `thinking: { type, budget_tokens }` | Anthropic、Kimi Coding、MiniMax Anthropic API |
| `qwen` | `enable_thinking: boolean` | DashScope / SiliconFlow / ModelScope 上的 Qwen-style 模型 |
| `deepseek` | DeepSeek 子模块统一转换 | DeepSeek V4 / reasoner |

`compat.reasoningProfile` 表示同一 wire format 内部更细的协议契约，例如
`deepseek-v4-anthropic` 表示 Anthropic Messages 请求体，但思考强度要写入
`output_config.effort`，并且工具调用历史需要在 serializer 前校验 thinking replay。

`core/model-sync.js` 会在投影 `models.json` 时把已知模型能力补成显式
`compat.thinkingFormat` / `compat.reasoningProfile`。`shared/model-capabilities.js`
保留旧 `models.json` 的读时兼容，避免升级后必须重新保存 provider 才恢复思考。

## 新增 FRC / Thinking 模型的维护规则

接入新模型时按下面顺序判断，避免把 provider 契约散到调用点：

1. 先确认模型是否具备 `reasoning` 能力。`reasoning: true` 只打开 UI / 偏好层的思考控制，不决定请求字段。
2. 再确认请求体大类，优先复用已有 `compat.thinkingFormat`：`anthropic`、`qwen`、`deepseek` 等。
3. 如果新模型和现有 format 使用同一种 wire format，但参数名、强度枚举、tool call 历史或 replay 规则不同，新增 `compat.reasoningProfile`。
4. profile 推导优先使用显式 `model.compat.reasoningProfile`；读时兼容可以在 `shared/model-capabilities.js` 基于 provider / baseUrl / api / known model family 推导。
5. profile 的具体行为只写在 `core/provider-compat/<provider>.js`：payload 映射走 `apply()`，serializer 前的历史校验走 `normalizeContextMessages()`。
6. 每个 profile 都要有测试覆盖：model-sync 投影、profile 推导、chat payload、utility payload、历史回放规则。

判断标准：如果换一个同 format 的 provider 之后规则还成立，放进 `thinkingFormat`；如果只对某个 provider 或某个模型族成立，放进 `reasoningProfile`。

## 已知子模块

| 文件 | 处理 provider | 删除条件 |
|---|---|---|
| [`deepseek.js`](deepseek.js) | DeepSeek 思考模式协议（含 reasoning_content 恢复/校验） | DeepSeek 不再要求回传 reasoning_content；或 pi-ai 直接处理 reasoning_content 字段不再走 thinkingSignature 路标 |
| [`qwen.js`](qwen.js) | Qwen-style 思考模型 `enable_thinking` quirk（utility mode 关思考；覆盖 dashscope / dashscope-coding / siliconflow / modelscope / infini） | quirks 系统重构 / Qwen-style 协议改成 reasoning_effort |

子模块的对外 API 仅有 `matches` 和 `apply` 两个 export。其它 export（如 `deepseek.js` 的 `extractReasoningFromContent`、`ensureReasoningContentForToolCalls`）属于实现细节、仅供同文件和单元测试访问，**不构成对外契约**。升级 SDK 想删 helper 时不需顾虑外部依赖。

## 历史背景

本架构由 commit `2a9ea17`（README 奠基）至 `0d87520`（llm-client 收口）一系列 commit 引入，根因来自 issue [#468](https://github.com/liliMozi/openhanako/issues/468) 的 DeepSeek 思考模式 400。设计 spec（本地工作文档，不入仓）：[docs/superpowers/specs/2026-04-26-provider-compat-layer-design.md](../../docs/superpowers/specs/2026-04-26-provider-compat-layer-design.md)。
