import path from "node:path";
import { createScopedConfigAccessor } from "../lib/scoped-config.js";

export const name = "generate-music";
export const description =
  "Generate music from a prompt and optional lyrics. Non-blocking: returns a media card and updates it when complete.";

export const parameters = {
  type: "object",
  properties: {
    prompt: { type: "string", description: "Music style or generation prompt" },
    lyrics: { type: "string", description: "Optional lyrics" },
    duration: { type: "number", description: "Optional duration in seconds" },
    genre: { type: "string", description: "Optional genre" },
    style: { type: "string", description: "Optional style" },
    instrumental: { type: "boolean", description: "Generate instrumental music" },
    format: { type: "string", description: "Output format, e.g. mp3, wav, flac" },
    output_format: { type: "string", description: "Response format, e.g. url, hex, base64" },
    sample_rate: { type: "number", description: "Audio sample rate" },
    bitrate: { type: "number", description: "Audio bitrate" },
    channel: { type: "number", description: "Audio channel count" },
    model: { type: "string", description: "Music model id" },
    provider: { type: "string", description: "Optional provider id, e.g. minimax" },
  },
  required: ["prompt"],
};

function resolveAdapter(registry, input, config) {
  const explicitProvider = String(input.provider || "").trim();
  if (explicitProvider) {
    const adapter = registry.get(explicitProvider);
    return adapter?.types?.includes("music") ? adapter : null;
  }
  const defaultMusicModel = config.get("defaultMusicModel");
  if (defaultMusicModel?.provider) {
    const adapter = registry.get(defaultMusicModel.provider);
    if (adapter?.types?.includes("music")) return adapter;
  }
  return registry.getByType("music").at(-1) || null;
}

export async function execute(input, ctx) {
  const { registry, store, poller } = ctx._mediaGen || {};
  if (!registry || !store || !poller) {
    return { content: [{ type: "text", text: "Music generation plugin is not initialized" }] };
  }

  const config = createScopedConfigAccessor(ctx, ctx.agentId || null);
  const adapter = resolveAdapter(registry, input, config);
  if (!adapter) {
    return { content: [{ type: "text", text: "No available music generation provider. Configure MiniMax or another music adapter." }] };
  }

  const defaultMusicModel = config.get("defaultMusicModel");
  const generatedDir = path.join(ctx.dataDir, "generated");
  const submitCtx = { dataDir: ctx.dataDir, bus: ctx.bus, log: ctx.log, generatedDir, config };
  const batchId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const params = {
    type: "music",
    prompt: input.prompt,
    provider: adapter.id,
    providerId: adapter.id,
    ...(input.lyrics && { lyrics: input.lyrics }),
    ...(input.duration != null && { duration: input.duration }),
    ...(input.genre && { genre: input.genre }),
    ...(input.style && { style: input.style }),
    ...(input.instrumental != null && { instrumental: input.instrumental }),
    ...(input.format && { format: input.format }),
    ...(input.output_format && { output_format: input.output_format }),
    ...(input.sample_rate != null && { sample_rate: input.sample_rate }),
    ...(input.bitrate != null && { bitrate: input.bitrate }),
    ...(input.channel != null && { channel: input.channel }),
    ...((input.model || defaultMusicModel?.id) && { model: input.model || defaultMusicModel.id }),
  };

  let result;
  try {
    result = await adapter.submit(params, submitCtx);
  } catch (err) {
    return { content: [{ type: "text", text: `Music submission failed: ${err?.message || "unknown error"}` }] };
  }

  if (!result?.taskId) {
    return { content: [{ type: "text", text: "Music submission failed: missing task id." }] };
  }

  store.add({
    taskId: result.taskId,
    adapterId: adapter.id,
    batchId,
    type: "music",
    prompt: input.prompt,
    params,
    sessionPath: ctx.sessionPath,
  });
  if (result.files?.length) store.update(result.taskId, { files: result.files });

  try {
    await ctx.bus.request("deferred:register", {
      taskId: result.taskId,
      sessionPath: ctx.sessionPath,
      meta: { type: "music-generation", prompt: input.prompt },
    });
  } catch (err) {
    ctx.log.warn(`deferred:register failed for ${result.taskId}:`, err);
  }

  try {
    await ctx.bus.request("task:register", {
      taskId: result.taskId,
      type: "media-generation",
      parentSessionPath: ctx.sessionPath,
      meta: { type: "music-generation", prompt: input.prompt },
    });
  } catch {}

  poller.add(result.taskId);

  return {
    content: [{ type: "text", text: "Submitted music generation task. The card below will update when complete." }],
    details: {
      card: {
        type: "iframe",
        route: `/card?batch=${batchId}`,
        title: "Music Generation",
        description: input.prompt.slice(0, 60),
        aspectRatio: "4:1",
      },
    },
  };
}
