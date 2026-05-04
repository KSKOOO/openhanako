import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/debug-log.js", () => ({
  debugLog: () => null,
}));

import { createWechatAdapter } from "../lib/bridge/wechat-adapter.js";

function jsonResponse(body) {
  return {
    ok: true,
    text: async () => JSON.stringify(body),
  };
}

describe("createWechatAdapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not report connected until the first getupdates call succeeds", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ret: 0, msgs: [], get_updates_buf: "buf-1" }))
      .mockImplementationOnce(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    const onStatus = vi.fn();
    const adapter = createWechatAdapter({
      botToken: "wx-token",
      agentId: "hana",
      onMessage: vi.fn(),
      onStatus,
    });

    expect(onStatus).not.toHaveBeenCalledWith("connected");
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith("connected"));

    adapter.stop();
  });

  it("reports error after repeated poll failures", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const onStatus = vi.fn();
    const adapter = createWechatAdapter({
      botToken: "wx-token",
      agentId: "hana",
      onMessage: vi.fn(),
      onStatus,
    });

    await vi.advanceTimersByTimeAsync(8_000);

    expect(onStatus).toHaveBeenCalledWith("error", expect.stringContaining("network down"));
    adapter.stop();
  });
});
