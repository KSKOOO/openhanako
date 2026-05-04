import { describe, it, expect } from "vitest";
import {
  buildUiContextReminder,
  injectReminderIntoLastUserMessage,
} from "../core/ui-context-reminder.js";

describe("buildUiContextReminder", () => {
  it("all fields present → full reminder with current_folder, active_file, pinned_files", () => {
    const r = buildUiContextReminder(
      {
        currentViewed: "/root/sub",
        activeFile: "/root/便利店.md",
        pinnedFiles: ["/root/old.md", "/root/notes.md"],
      },
      "/root",
    );
    expect(r).toBe(
      "<user-context>\n" +
        "current_folder: /root/sub\n" +
        "active_file: /root/便利店.md\n" +
        "pinned_files:\n" +
        "  - /root/old.md\n" +
        "  - /root/notes.md\n" +
        "</user-context>\n\n",
    );
  });

  it("currentViewed equal to sessionCwd → omit current_folder（去冗余）", () => {
    const r = buildUiContextReminder(
      { currentViewed: "/root", activeFile: "/root/x.md" },
      "/root",
    );
    expect(r).toBe(
      "<user-context>\nactive_file: /root/x.md\n</user-context>\n\n",
    );
  });

  it("activeArtifact only (no filePath) → active_artifact line", () => {
    const r = buildUiContextReminder(
      { activeArtifact: "便利店.md" },
      "/root",
    );
    expect(r).toContain('active_artifact: "便利店.md"（前文生成的文稿）');
  });

  it("activeFile 和 activeArtifact 同时提供 → 只输出 active_file（前者优先）", () => {
    const r = buildUiContextReminder(
      { activeFile: "/a/b.md", activeArtifact: "ghost" },
      "/root",
    );
    expect(r).toContain("active_file: /a/b.md");
    expect(r).not.toContain("active_artifact");
  });

  it("pinnedFiles 空数组 → 整段省略", () => {
    const r = buildUiContextReminder(
      { activeFile: "/a/b.md", pinnedFiles: [] },
      "/root",
    );
    expect(r).not.toContain("pinned_files");
  });

  it("pinnedFiles 未提供 → 整段省略", () => {
    const r = buildUiContextReminder({ activeFile: "/a/b.md" }, "/root");
    expect(r).not.toContain("pinned_files");
  });

  it("只 pinnedFiles 有值 → 只输出 pinned_files 段", () => {
    const r = buildUiContextReminder(
      { pinnedFiles: ["/a", "/b"] },
      "/root",
    );
    expect(r).toBe(
      "<user-context>\npinned_files:\n  - /a\n  - /b\n</user-context>\n\n",
    );
  });

  it("全空 → null", () => {
    expect(buildUiContextReminder({}, "/root")).toBeNull();
    expect(buildUiContextReminder({ pinnedFiles: [] }, "/root")).toBeNull();
    expect(
      buildUiContextReminder(
        { currentViewed: "/root" }, // 等于 cwd 被去除
        "/root",
      ),
    ).toBeNull();
  });

  it("uiCtx 为 null / undefined → null", () => {
    expect(buildUiContextReminder(null, "/root")).toBeNull();
    expect(buildUiContextReminder(undefined, "/root")).toBeNull();
  });

  it("sessionCwd 为 null → currentViewed 正常写入（不做相等比较）", () => {
    const r = buildUiContextReminder(
      { currentViewed: "/root/sub" },
      null,
    );
    expect(r).toContain("current_folder: /root/sub");
  });
});

describe("injectReminderIntoLastUserMessage", () => {
  const reminder = "<user-context>\nactive_file: /x\n</user-context>\n\n";

  it("string content → 前缀 reminder", () => {
    const messages = [
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "follow-up" },
    ];
    injectReminderIntoLastUserMessage(messages, reminder);
    expect(messages[3].content).toBe(reminder + "follow-up");
    // 之前的 user message 不应被改
    expect(messages[1].content).toBe("hello");
  });

  it("content 是 content block 数组，首个 text block → 注入 text block 开头", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "image", source: { data: "xxx" } },
          { type: "text", text: "actual question" },
        ],
      },
    ];
    injectReminderIntoLastUserMessage(messages, reminder);
    expect(messages[0].content[0].type).toBe("image");
    expect(messages[0].content[1].type).toBe("text");
    expect(messages[0].content[1].text).toBe(reminder + "actual question");
  });

  it("content 是数组但没 text block → 开头插入新 text block", () => {
    const messages = [
      {
        role: "user",
        content: [{ type: "image", source: { data: "xxx" } }],
      },
    ];
    injectReminderIntoLastUserMessage(messages, reminder);
    expect(messages[0].content).toHaveLength(2);
    expect(messages[0].content[0]).toEqual({ type: "text", text: reminder });
    expect(messages[0].content[1].type).toBe("image");
  });

  it("无 user message → no-op", () => {
    const messages = [
      { role: "system", content: "sys" },
      { role: "assistant", content: "hi" },
    ];
    injectReminderIntoLastUserMessage(messages, reminder);
    expect(messages[0].content).toBe("sys");
    expect(messages[1].content).toBe("hi");
  });

  it("只改最后一条 user message，不改之前的 user", () => {
    const messages = [
      { role: "user", content: "first" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "second" },
      { role: "assistant", content: "hi2" },
      { role: "user", content: "third" },
    ];
    injectReminderIntoLastUserMessage(messages, reminder);
    expect(messages[0].content).toBe("first");
    expect(messages[2].content).toBe("second");
    expect(messages[4].content).toBe(reminder + "third");
  });

  it("返回值包含 messages 同一个引用", () => {
    const messages = [{ role: "user", content: "x" }];
    const result = injectReminderIntoLastUserMessage(messages, reminder);
    expect(result.messages).toBe(messages);
  });
});
