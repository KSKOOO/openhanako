import path from "node:path";
import { createScopedConfigAccessor } from "../lib/scoped-config.js";

export const name = "generate-audio";
export const description =
  "Generate speech audio from text. Non-blocking: returns a media card and updates it when complete.";

export const parameters = {
  type: "object",
  properties: {
    text: { type: "string", description: "Text to synthesize" },
    prompt: { type: "string", description: "Alias for text" },
    voice_id: { type: "string", description: "Voice id" },
    voice: { type: "string", description: "Alias for voice_id" },
    speed: { type: "number", description: "Speech speed" },
    volume: { type: "number", description: "Speech volume" },
    pitch: { type: "number", description: "Speech pitch" },
    format: { type: "string", description: "Output format, e.g. mp3, wav, flac" },
    output_format: { type: "string", description: "Response format, e.g. hex, url, base64" },
    sample_rate: { type: "number", description: "Audio sample rate" },
    bitrate: { type: "number", description: "Audio bitrate" },
    channel: { type: "number", description: "Audio channel count" },
    model: { type: "string", description: "Audio model id" },
    provider: { type: "string", description: "Optional provider id, e.g. minimax" },
  },
  required: [],
};

function resolveAdapter(registry, input, config) {
  const explicitProvider = String(input.provider || "").trim();
  if (explicitProvider) {
    const adapter = registry.get(explicitProvider);
    return adapter?.types?.includes("audio") ? adapter : null;
  }
  const defaultAudioModel = config.get("defaultAudioModel");
  if (defaultAudioModel?.provider) {
    const adapter = registry.get(defaultAudioModel.provider);
    if (adapter?.types?.includes("audio")) return adapter;
  }
  return registry.getByType("audio").at(-1) || null;
}

export async function execute(input, ctx) {
  const { registry, store, poller } = ctx._mediaGen || {};
  if (!registry || !store || !poller) {
    return { content: [{ type: "text", text: "Audio generation plugin is not initialized" }] };
  }

  const text = input.text || input.prompt;
  if (!text) {
    return { content: [{ type: "text", text: "Audio generation requires text." }] };
  }

  const config = createScopedConfigAccessor(ctx, ctx.agentId || null);
  const adapter = resolveAdapter(registry, input, config);
  if (!adapter) {
    return { content: [{ type: "text", text: "No available audio generation provider. Configure MiniMax or another audio adapter." }] };
  }

  const defaultAudioModel = config.get("defaultAudioModel");
  const generatedDir = path.join(ctx.dataDir, "generated");
  const submitCtx = { dataDir: ctx.dataDir, bus: ctx.bus, log: ctx.log, generatedDir, config };
  const batchId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const params = {
    type: "audio",
    text,
    prompt: text,
    provider: adapter.id,
    providerId: adapter.id,
    ...(input.voice_id && { voice_id: input.voice_id }),
    ...(input.voice && { voice: input.voice }),
    ...(input.speed != null && { speed: input.speed }),
    ...(input.volume != null && { volume: input.volume }),
    ...(input.pitch != null && { pitch: input.pitch }),
    ...(input.format && { format: input.format }),
    ...(input.output_format && { output_format: input.output_format }),
    ...(input.sample_rate != null && { sample_rate: input.sample_rate }),
    ...(input.bitrate != null && { bitrate: input.bitrate }),
    ...(input.channel != null && { channel: input.channel }),
    ...((input.model || defaultAudioModel?.id) && { model: input.model || defaultAudioModel.id }),
  };

  let result;
  try {
    result = await adapter.submit(params, submitCtx);
  } catch (err) {
    return { content: [{ type: "text", text: `Audio submission failed: ${err?.message || "unknown error"}` }] };
  }

  if (!result?.taskId) {
    return { content: [{ type: "text", text: "Audio submission failed: missing task id." }] };
  }

  store.add({
    taskId: result.taskId,
    adapterId: adapter.id,
    batchId,
    type: "audio",
    prompt: text,
    params,
    sessionPath: ctx.sessionPath,
  });
  if (result.files?.length) store.update(result.taskId, { files: result.files });

  try {
    await ctx.bus.request("deferred:register", {
      taskId: result.taskId,
      sessionPath: ctx.sessionPath,
      meta: { type: "audio-generation", prompt: text },
    });
  } catch (err) {
    ctx.log.warn(`deferred:register failed for ${result.taskId}:`, err);
  }

  try {
    await ctx.bus.request("task:register", {
      taskId: result.taskId,
      type: "media-generation",
      parentSessionPath: ctx.sessionPath,
      meta: { type: "audio-generation", prompt: text },
    });
  } catch {}

  poller.add(result.taskId);

  return {
    content: [{ type: "text", text: "Submitted audio generation task. The card below will update when complete." }],
    details: {
      card: {
        type: "iframe",
        route: `/card?batch=${batchId}`,
        title: "Audio Generation",
        description: text.slice(0, 60),
        aspectRatio: "4:1",
      },
    },
  };
}
