/**
 * plugins/image-gen/tools/generate-image.js
 *
 * Non-blocking image generation. Submits via adapter, returns card immediately.
 */
import path from "node:path";
import { resolveImageAdapter } from "../lib/resolve-image-adapter.js";
import { createScopedConfigAccessor } from "../lib/scoped-config.js";

export const name = "generate-image";
export const description =
  "Generate images from a text prompt. Non-blocking: returns a card immediately and updates it when done.";

export const parameters = {
  type: "object",
  properties: {
    prompt: { type: "string", description: "Image prompt" },
    count: { type: "number", description: "Number of images to submit, default 1, max 4" },
    image: { type: "string", description: "Legacy single reference image path or URL for image-to-image" },
    images: {
      type: "array",
      items: { type: "string" },
      description: "Ordered reference image paths or URLs for image-to-image; supports multiple images",
    },
    ratio: { type: "string", description: "Aspect ratio, e.g. 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9" },
    aspect_ratio: { type: "string", description: "Alias for ratio" },
    resolution: { type: "string", description: "Resolution tier, e.g. 2k or 4k" },
    size: { type: "string", description: "Provider size value, e.g. 1024x1024, landscape, square, portrait, 2K, 4K" },
    quality: { type: "string", description: "Image quality, e.g. low, medium, high, standard, hd" },
    model: { type: "string", description: "Image model id or version" },
    provider: { type: "string", description: "Optional provider id" },
  },
  required: ["prompt"],
};

function normalizeSizeValue(value) {
  if (value == null || value === "") return null;
  const str = String(value).trim();
  if (!str) return null;
  return /^(2k|4k)$/i.test(str) ? str.toUpperCase() : str;
}

function normalizeReferenceImages(input) {
  const refs = [];
  const seen = new Set();
  const add = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) add(item);
      return;
    }
    const ref = String(value).trim();
    if (!ref || seen.has(ref)) return;
    seen.add(ref);
    refs.push(ref);
  };

  add(input.images);
  add(input.image);
  return refs;
}

export async function execute(input, ctx) {
  const { registry, store, poller } = ctx._mediaGen || {};
  if (!registry || !store || !poller) {
    return { content: [{ type: "text", text: "Image generation plugin is not initialized" }] };
  }

  const generatedDir = path.join(ctx.dataDir, "generated");
  const config = createScopedConfigAccessor(ctx, ctx.agentId || null);
  const submitCtx = { dataDir: ctx.dataDir, bus: ctx.bus, log: ctx.log, generatedDir, config };

  const defaultImageModel = config.get("defaultImageModel") || null;
  let resolved;
  try {
    resolved = await resolveImageAdapter({
      registry,
      bus: ctx.bus,
      inputProvider: input.provider || "",
      defaultImageModel,
    });
  } catch (err) {
    return { content: [{ type: "text", text: `Image generation provider is unavailable: ${err?.message || "unknown error"}` }] };
  }

  const adapter = resolved.adapter;
  const providerId = resolved.providerId || input.provider || defaultImageModel?.provider || "";
  if (!adapter) {
    return { content: [{ type: "text", text: "No available image generation provider" }] };
  }

  const count = Math.min(Math.max(input.count || 1, 1), 4);
  const batchId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const aspectRatio = input.aspect_ratio || input.aspectRatio || input.ratio || null;
  const size = normalizeSizeValue(input.size || input.resolution);
  const resolution = normalizeSizeValue(input.resolution);
  const referenceImages = normalizeReferenceImages(input);

  const params = {
    type: "image",
    prompt: input.prompt,
    provider: providerId,
    providerId,
    ...(aspectRatio && { ratio: aspectRatio, aspect_ratio: aspectRatio }),
    ...(resolution && { resolution }),
    ...(size && { size }),
    ...(input.quality && { quality: input.quality }),
    ...((input.model || resolved.modelId) && { model: input.model || resolved.modelId }),
    ...(referenceImages.length === 1 && { image: referenceImages[0] }),
    ...(referenceImages.length > 1 && { image: referenceImages }),
  };

  const promises = Array.from({ length: count }, () =>
    adapter.submit(params, submitCtx).catch((err) => ({ _error: err })),
  );
  const results = await Promise.all(promises);

  const succeeded = [];
  let failCount = 0;

  for (const r of results) {
    if (r._error || !r.taskId) {
      failCount++;
      continue;
    }
    succeeded.push(r);

    store.add({
      taskId: r.taskId,
      adapterId: adapter.id,
      batchId,
      type: "image",
      prompt: input.prompt,
      params,
      sessionPath: ctx.sessionPath,
    });

    if (r.files?.length) {
      store.update(r.taskId, { files: r.files });
    }

    try {
      await ctx.bus.request("deferred:register", {
        taskId: r.taskId,
        sessionPath: ctx.sessionPath,
        meta: { type: "image-generation", prompt: input.prompt },
      });
    } catch (err) {
      ctx.log.warn(`deferred:register failed for ${r.taskId}:`, err);
    }

    try {
      await ctx.bus.request("task:register", {
        taskId: r.taskId,
        type: "media-generation",
        parentSessionPath: ctx.sessionPath,
        meta: { type: "image-generation", prompt: input.prompt },
      });
    } catch {}

    poller.add(r.taskId);
  }

  if (succeeded.length === 0) {
    const firstErr = results.find((r) => r._error)?._error;
    return {
      content: [{ type: "text", text: `Image submission failed: ${firstErr?.message || "unknown error"}` }],
    };
  }

  let text = `Submitted ${succeeded.length} image generation task(s). The card below will update when complete.`;
  if (failCount > 0) text += `\n${failCount} submission(s) failed. Check network, quota, or provider parameters.`;

  return {
    content: [{ type: "text", text }],
    details: {
      card: {
        type: "iframe",
        route: `/card?batch=${batchId}`,
        title: "Image Generation",
        description: `${input.prompt.slice(0, 60)} (${succeeded.length})`,
        aspectRatio: aspectRatio || "1:1",
      },
    },
  };
}
