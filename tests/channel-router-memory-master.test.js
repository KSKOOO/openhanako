import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callTextMock, factAddMock } = vi.hoisted(() => ({
  callTextMock: vi.fn(),
  factAddMock: vi.fn(),
}));

vi.mock("../core/llm-client.js", () => ({
  callText: callTextMock,
}));

vi.mock("../lib/memory/fact-store.js", () => ({
  FactStore: vi.fn(function FactStoreMock() {
    this.add = factAddMock;
    this.close = vi.fn();
  }),
}));

vi.mock("../lib/debug-log.js", () => ({
  debugLog: () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  createModuleLogger: () => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { ChannelRouter } from "../hub/channel-router.js";

let rootDir;

function writeAgentFixture(memoryEnabled) {
  const agentsDir = path.join(rootDir, "agents");
  const agentDir = path.join(agentsDir, "hana");
  const productDir = path.join(rootDir, "product");
  const userDir = path.join(rootDir, "user");
  fs.mkdirSync(path.join(agentDir, "memory"), { recursive: true });
  fs.mkdirSync(path.join(productDir, "yuan"), { recursive: true });
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "config.yaml"),
    [
      "agent:",
      "  name: Hana",
      "  yuan: hanako",
      "memory:",
      `  enabled: ${memoryEnabled ? "true" : "false"}`,
    ].join("\n"),
    "utf-8",
  );
  fs.writeFileSync(path.join(agentDir, "identity.md"), "IDENTITY_FALLBACK_BEACON\n", "utf-8");
  fs.writeFileSync(path.join(agentDir, "ishiki.md"), "ISHIKI_FALLBACK_BEACON\n", "utf-8");
  fs.writeFileSync(path.join(agentDir, "memory", "memory.md"), "MEMORY_FALLBACK_BEACON\n", "utf-8");
  fs.writeFileSync(path.join(productDir, "yuan", "hanako.md"), "YUAN_FALLBACK_BEACON\n", "utf-8");
  fs.writeFileSync(path.join(userDir, "user.md"), "USER_PROFILE_BEACON\n", "utf-8");
  return { agentsDir, productDir, userDir };
}

function makeRouter(paths) {
  return new ChannelRouter({
    hub: {
      engine: {
        agentsDir: paths.agentsDir,
        channelsDir: path.join(rootDir, "channels"),
        productDir: paths.productDir,
        userDir: paths.userDir,
        agents: undefined,
        getAgent: () => null,
        resolveUtilityConfig: () => ({
          utility: "test-model",
          utility_large: "test-model-large",
          api_key: "test-key",
          base_url: "https://test.api",
          api: "openai-completions",
          large_api_key: "test-key",
          large_base_url: "https://test.api",
          large_api: "openai-completions",
        }),
      },
      eventBus: { emit: vi.fn() },
    },
  });
}

describe("ChannelRouter memory master fallback", () => {
  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "channel-memory-master-"));
    callTextMock.mockReset();
    factAddMock.mockReset();
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("uses config.yaml memory.enabled when triage has no live agent instance", async () => {
    const paths = writeAgentFixture(false);
    const router = makeRouter(paths);
    callTextMock.mockResolvedValue("NO");

    await router._executeCheck(
      "hana",
      "general",
      [{ sender: "user", text: "hello" }],
      [],
    );

    expect(callTextMock).toHaveBeenCalledOnce();
    const systemPrompt = callTextMock.mock.calls[0][0].systemPrompt;
    expect(systemPrompt).toContain("IDENTITY_FALLBACK_BEACON");
    expect(systemPrompt).toContain("USER_PROFILE_BEACON");
    expect(systemPrompt).not.toContain("MEMORY_FALLBACK_BEACON");
  });

  it("skips memory summarization from config.yaml when no live agent instance exists", async () => {
    const paths = writeAgentFixture(false);
    const router = makeRouter(paths);
    callTextMock.mockResolvedValue("summary");

    await router._memorySummarize("hana", "general", "context");

    expect(callTextMock).not.toHaveBeenCalled();
    expect(factAddMock).not.toHaveBeenCalled();
  });
});
