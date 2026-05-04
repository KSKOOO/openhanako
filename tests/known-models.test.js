import { describe, expect, it } from "vitest";

import { lookupKnown } from "../shared/known-models.js";

describe("known-models dictionary", () => {
  it("keeps current OpenAI GPT-5.4 API context metadata", () => {
    expect(lookupKnown("openai", "gpt-5.4")).toMatchObject({
      name: "GPT-5.4",
      context: 1050000,
      maxOutput: 128000,
      image: true,
      reasoning: true,
    });
    expect(lookupKnown("openai", "gpt-5.4-mini")).toMatchObject({
      context: 400000,
      maxOutput: 128000,
      image: true,
      reasoning: true,
    });
  });

  it("declares GPT-5.5 metadata for Codex OAuth with conservative context", () => {
    expect(lookupKnown("openai-codex-oauth", "gpt-5.5")).toEqual({
      name: "GPT-5.5",
      context: 400000,
      maxOutput: 128000,
      image: true,
      reasoning: true,
    });
  });

  it("declares recent frontier and agent model metadata by provider", () => {
    expect(lookupKnown("openai", "gpt-5.5")).toMatchObject({
      context: 1050000,
      maxOutput: 128000,
      image: true,
      reasoning: true,
    });
    expect(lookupKnown("anthropic", "claude-opus-4-7")).toMatchObject({
      context: 1000000,
      maxOutput: 128000,
      image: true,
      reasoning: true,
    });
    expect(lookupKnown("dashscope", "qwen3.6-plus")).toMatchObject({
      context: 1000000,
      maxOutput: 65536,
      image: true,
      reasoning: true,
      quirks: ["enable_thinking"],
    });
    expect(lookupKnown("zhipu", "glm-5.1")).toMatchObject({
      context: 200000,
      maxOutput: 128000,
      image: false,
      reasoning: true,
    });
    expect(lookupKnown("mistral", "mistral-small-2603")).toMatchObject({
      context: 256000,
      maxOutput: 256000,
      reasoning: true,
    });
    expect(lookupKnown("xai", "grok-4.20-reasoning")).toMatchObject({
      context: 2000000,
      maxOutput: 2000000,
      image: true,
      reasoning: true,
    });
  });

  it("uses generic model fallbacks when a provider has no provider-specific entry", () => {
    expect(lookupKnown("volcengine", "kimi-k2.6")).toMatchObject({
      name: "Kimi K2.6",
      context: 262144,
      maxOutput: 98304,
      image: true,
      reasoning: true,
    });
  });

  it("keeps provider-specific metadata ahead of generic fallbacks", () => {
    expect(lookupKnown("openai-codex-oauth", "gpt-5.5")).toMatchObject({
      context: 400000,
    });
    expect(lookupKnown("unknown-provider", "gpt-5.5")).toMatchObject({
      context: 1050000,
    });
  });

  it("does not treat arbitrary provider-specific entries as generic fallbacks", () => {
    expect(lookupKnown("unknown-provider", "openrouter/auto")).toBeNull();
  });
});
