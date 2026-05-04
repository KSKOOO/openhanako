/**
 * 消息发送前净化器 — capability-aware message adaptation layer
 *
 * 职责：按 Pi SDK Model.input 声明的输入模态，把历史 messages 里不兼容的
 * content block 替换为 TextContent 占位。目前处理 ImageContent；未来可扩展
 * AudioContent / VideoContent。
 *
 * 定位：注册为 Pi SDK "context" extension event handler（engine.js 内）。
 * "context" 事件在每次 LLM 调用前触发，允许修改 messages。
 *
 * 非静默降级：调用方（engine）根据返回的 stripped 计数决定是否通过事件总线
 * 通知 UI，避免用户悄无声息地丢失信息。
 */

const IMAGE_PLACEHOLDER_TEXT = "[图片已省略：当前模型不支持图像输入]";

/**
 * 模型是否支持 image 输入（Pi SDK 标准字段 input 数组）。
 * @param {{ input?: readonly string[] } | null | undefined} model
 */
export function modelSupportsImage(model) {
  const input = model?.input;
  return Array.isArray(input) && input.includes("image");
}

/**
 * 对 messages 做 provider 能力适配。当前只处理 image 模态。
 *
 * @param {ReadonlyArray<any>} messages
 * @param {{ input?: readonly string[] } | null | undefined} model
 * @returns {{ messages: any[], stripped: number }}
 */
export function sanitizeMessagesForModel(messages, model) {
  if (!Array.isArray(messages)) return { messages, stripped: 0 };
  if (modelSupportsImage(model)) return { messages, stripped: 0 };

  // 快速探测：没有任何需要剥离的 ImageContent 就返回原数组，避免无谓分配
  if (!hasImageContent(messages)) return { messages, stripped: 0 };

  let stripped = 0;
  const out = messages.map((msg) => {
    if (!msg || typeof msg !== "object") return msg;
    // 只扫可能携带 ImageContent 的消息种类：
    //  - user（UserMessage.content 可以是 (text|image)[])
    //  - toolResult（ToolResultMessage.content 可以是 (text|image)[])
    if (msg.role !== "user" && msg.role !== "toolResult") return msg;
    if (typeof msg.content === "string") return msg;
    if (!Array.isArray(msg.content)) return msg;

    let localStripped = 0;
    const newContent = [];
    for (const block of msg.content) {
      if (block && typeof block === "object" && block.type === "image") {
        localStripped++;
        newContent.push({ type: "text", text: IMAGE_PLACEHOLDER_TEXT });
      } else {
        newContent.push(block);
      }
    }
    if (localStripped === 0) return msg;
    stripped += localStripped;
    return { ...msg, content: newContent };
  });

  return { messages: out, stripped };
}

/** 快速判断 messages 里是否存在至少一个 ImageContent block。 */
function hasImageContent(messages) {
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    if (msg.role !== "user" && msg.role !== "toolResult") continue;
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block && typeof block === "object" && block.type === "image") return true;
    }
  }
  return false;
}
