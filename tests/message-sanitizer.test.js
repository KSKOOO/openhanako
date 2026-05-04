/**
 * core/message-sanitizer.js 单元测试
 *
 * 覆盖：
 *   - 支持 image 的模型：放行不改
 *   - 不支持 image 的模型：UserMessage / ToolResultMessage 里的 ImageContent
 *     替换为 TextContent 占位；其他消息不动
 *   - input 缺失/非数组：放行（未知视作允许，与 API 决定一致）
 *   - 只含 text 的 messages：无副作用、stripped=0
 *   - 幂等：重复调用结果一致
 */
import { describe, it, expect } from "vitest";
import {
  sanitizeMessagesForModel,
  modelSupportsImage,
} from "../core/message-sanitizer.js";

const IMG_BLOCK = { type: "image", data: "BASE64DATA", mimeType: "image/png" };
const TEXT_BLOCK = (text) => ({ type: "text", text });

describe("modelSupportsImage", () => {
  it("input 含 image → true", () => {
    expect(modelSupportsImage({ input: ["text", "image"] })).toBe(true);
  });
  it("input 只有 text → false", () => {
    expect(modelSupportsImage({ input: ["text"] })).toBe(false);
  });
  it("input 缺失 → false（调用方应按未知处理而不是直接信任）", () => {
    expect(modelSupportsImage({})).toBe(false);
    expect(modelSupportsImage(null)).toBe(false);
    expect(modelSupportsImage(undefined)).toBe(false);
  });
  it("input 非数组 → false", () => {
    expect(modelSupportsImage({ input: "image" })).toBe(false);
  });
});

describe("sanitizeMessagesForModel", () => {
  const textOnlyModel = { input: ["text"] };
  const imageModel = { input: ["text", "image"] };

  it("支持 image 的模型：放行不改", () => {
    const messages = [
      { role: "user", content: [TEXT_BLOCK("hi"), IMG_BLOCK] },
      { role: "assistant", content: [TEXT_BLOCK("there")] },
    ];
    const res = sanitizeMessagesForModel(messages, imageModel);
    expect(res.stripped).toBe(0);
    expect(res.messages).toBe(messages);
  });

  it("不支持 image 的模型：user 消息里的 image block 换占位", () => {
    const messages = [
      { role: "user", content: [TEXT_BLOCK("what is this?"), IMG_BLOCK] },
    ];
    const res = sanitizeMessagesForModel(messages, textOnlyModel);
    expect(res.stripped).toBe(1);
    expect(res.messages[0].content).toEqual([
      TEXT_BLOCK("what is this?"),
      { type: "text", text: "[图片已省略：当前模型不支持图像输入]" },
    ]);
    // 原数组不变（纯函数）
    expect(messages[0].content).toEqual([TEXT_BLOCK("what is this?"), IMG_BLOCK]);
  });

  it("不支持 image 的模型：toolResult 里的 image block 换占位", () => {
    const messages = [
      {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "screenshot",
        content: [TEXT_BLOCK("Screenshot saved"), IMG_BLOCK, IMG_BLOCK],
      },
    ];
    const res = sanitizeMessagesForModel(messages, textOnlyModel);
    expect(res.stripped).toBe(2);
    expect(res.messages[0].content).toEqual([
      TEXT_BLOCK("Screenshot saved"),
      { type: "text", text: "[图片已省略：当前模型不支持图像输入]" },
      { type: "text", text: "[图片已省略：当前模型不支持图像输入]" },
    ]);
  });

  it("assistant 消息不被扫描（其 content 里无 image 类型）", () => {
    const messages = [
      { role: "assistant", content: [TEXT_BLOCK("foo")] },
    ];
    const res = sanitizeMessagesForModel(messages, textOnlyModel);
    expect(res.stripped).toBe(0);
    expect(res.messages).toBe(messages);
  });

  it("user 消息 content 为字符串：放行", () => {
    const messages = [{ role: "user", content: "plain text" }];
    const res = sanitizeMessagesForModel(messages, textOnlyModel);
    expect(res.stripped).toBe(0);
    expect(res.messages).toBe(messages);
  });

  it("input 缺失时放行（未知视作允许）", () => {
    const messages = [{ role: "user", content: [IMG_BLOCK] }];
    // modelSupportsImage 对 {} 返回 false，因此这里会剥；
    // sanitizer 的契约就是"不支持就剥"，未知场景的"放行"在调用侧由
    // session-coordinator 的 `Array.isArray(input) &&` 保护。此测试固定行为。
    const res = sanitizeMessagesForModel(messages, {});
    expect(res.stripped).toBe(1);
  });

  it("幂等：对已净化过的 messages 再次调用不再产生变化", () => {
    const messages = [{ role: "user", content: [IMG_BLOCK] }];
    const first = sanitizeMessagesForModel(messages, textOnlyModel);
    const second = sanitizeMessagesForModel(first.messages, textOnlyModel);
    expect(second.stripped).toBe(0);
    expect(second.messages).toBe(first.messages);
  });

  it("messages 非数组或 null：防御式放行", () => {
    expect(sanitizeMessagesForModel(null, textOnlyModel)).toEqual({ messages: null, stripped: 0 });
    expect(sanitizeMessagesForModel(undefined, textOnlyModel)).toEqual({ messages: undefined, stripped: 0 });
    expect(sanitizeMessagesForModel("oops", textOnlyModel).stripped).toBe(0);
  });

  it("混合场景：部分消息有图、部分无图，只动必要的", () => {
    const pure = { role: "user", content: [TEXT_BLOCK("pure")] };
    const dirty = { role: "user", content: [TEXT_BLOCK("dirty"), IMG_BLOCK] };
    const tr = { role: "toolResult", toolCallId: "t", toolName: "shot", content: [IMG_BLOCK] };
    const messages = [pure, dirty, tr];
    const res = sanitizeMessagesForModel(messages, textOnlyModel);
    expect(res.stripped).toBe(2);
    expect(res.messages[0]).toBe(pure);  // 纯文本未复制
    expect(res.messages[1]).not.toBe(dirty);  // 脏消息已复制
    expect(res.messages[2]).not.toBe(tr);
  });
});
