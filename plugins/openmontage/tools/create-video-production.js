import { extractRuntimeOverrides, sanitizeTaskParams } from "../lib/runtime-options.js";

export const name = "create-video-production";
export const description =
  "Turn a creative brief into an OpenMontage video-production task. Returns immediately with a progress card and publishes the final video file when rendering finishes.";

export const parameters = {
  type: "object",
  properties: {
    prompt: { type: "string", description: "Creative brief for the video production." },
    duration: { type: "number", description: "Target duration in seconds." },
    aspectRatio: { type: "string", description: "Target aspect ratio like 16:9 or 9:16." },
    resolution: { type: "string", description: "Optional render resolution like 1280x720 or 1080x1920." },
    style: { type: "string", description: "Optional style or look direction." },
    assetsDir: { type: "string", description: "Optional local folder with source assets." },
    mode: {
      type: "string",
      description: "Execution mode. Use auto for normal routing, agent for the full OpenMontage agent flow, or direct-remotion for the fast local composition path.",
      enum: ["auto", "agent", "direct-remotion"],
    },
    fastMode: { type: "boolean", description: "Prefer the fast local Remotion path and lower-latency render defaults when possible." },
    pipeline: { type: "string", description: "Optional OpenMontage pipeline hint such as animated-explainer or animation." },
    provider: { type: "string", description: "Preferred video provider, for example runway, fal, minimax, heygen, xai, or local." },
    model: { type: "string", description: "Preferred provider model or variant." },
    apiKey: { type: "string", description: "Optional provider API key for this run only. It is passed at runtime and is not stored in the task snapshot." },
    baseUrl: { type: "string", description: "Optional provider base URL or endpoint override." },
    providerEnvOverrides: {
      type: "object",
      description: "Optional runtime environment overrides for OpenMontage providers. Keys should be environment variable names.",
      additionalProperties: { type: "string" },
    },
    agentBackend: { type: "string", description: "Optional local coding backend for the built-in OpenMontage agent executor, such as codex or claude." },
  },
  required: ["prompt"],
};

export async function execute(input, ctx) {
  const openMontage = ctx._openMontage || {};
  if (!openMontage.store || !openMontage.runner) {
    return { content: [{ type: "text", text: "OpenMontage plugin is not initialized." }] };
  }

  const batchId = createId();
  const taskId = `montage-${batchId}`;
  const prompt = String(input.prompt || "").trim();
  const taskParams = sanitizeTaskParams(input);
  const runtimeOverrides = extractRuntimeOverrides(input);

  const task = {
    taskId,
    batchId,
    type: "video-production",
    prompt,
    params: taskParams,
    sessionPath: ctx.sessionPath,
    createdAt: new Date().toISOString(),
  };

  openMontage.store.add(task);

  try {
    await ctx.bus.request("deferred:register", {
      taskId,
      sessionPath: ctx.sessionPath,
      meta: { type: "video-production", prompt },
    });
  } catch (err) {
    ctx.log.warn(`deferred:register failed for ${taskId}:`, err);
  }

  try {
    await ctx.bus.request("task:register", {
      taskId,
      type: "openmontage-generation",
      parentSessionPath: ctx.sessionPath,
      meta: { type: "video-production", prompt },
    });
  } catch {}

  await openMontage.runner.submit(task, runtimeOverrides);

  return {
    content: [{
      type: "text",
      text: `OpenMontage video task submitted. Current request: ${prompt}`,
    }],
    details: {
      card: {
        type: "iframe",
        route: `/card?batch=${batchId}`,
        title: "OpenMontage Video Production",
        description: prompt.slice(0, 80),
        aspectRatio: taskParams.aspectRatio,
      },
    },
  };
}

function createId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
