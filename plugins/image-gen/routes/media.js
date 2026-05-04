/* global Response, TransformStream */
// plugins/image-gen/routes/media.js
import fs from "fs";
import path from "path";
import { buildMediaProviders } from "../lib/provider-utils.js";
import { createScopedConfigAccessor } from "../lib/scoped-config.js";
import { isInvalidJsonBodyError, routeError, strictJson } from "../../../server/hono-helpers.js";

const MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  ogg: "audio/ogg",
};

function isInvalidFilename(filename) {
  return filename.includes("/") || filename.includes("\\") || filename.includes("..");
}

function safeDownloadName(filename) {
  return filename.replace(/["\r\n]/g, "_");
}

async function safeBusRequest(ctx, type, payload, fallback) {
  try {
    if (!ctx.bus?.request) return fallback;
    return await ctx.bus.request(type, payload) || fallback;
  } catch (err) {
    ctx.log?.warn?.(`[image-gen] ${type} unavailable, using media provider fallback: ${err.message}`);
    return fallback;
  }
}

export default function (app, ctx) {
  // Serve generated media — streaming + Range support
  app.get("/media/:filename", async (c) => {
    const filename = c.req.param("filename");
    if (isInvalidFilename(filename)) {
      return c.json({ error: "invalid filename" }, 400);
    }
    const filePath = path.join(ctx.dataDir, "generated", filename);

    let stat;
    try { stat = fs.statSync(filePath); } catch { return c.json({ error: "not found" }, 404); }

    const ext = path.extname(filename).slice(1);
    const mime = MIME[ext] || "application/octet-stream";
    const total = stat.size;
    const range = c.req.header("range");

    if (range) {
      // Range request — partial content (video seeking, progressive load)
      const match = range.match(/bytes=(\d*)-(\d*)/);
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : total - 1;
      const chunkSize = end - start + 1;

      const stream = fs.createReadStream(filePath, { start, end });
      const { readable, writable } = new TransformStream();
      streamPipe(stream, writable);

      return new Response(readable, {
        status: 206,
        headers: {
          "Content-Type": mime,
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Content-Length": String(chunkSize),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    // Full request — stream the entire file (no readFileSync)
    const stream = fs.createReadStream(filePath);
    const { readable, writable } = new TransformStream();
    streamPipe(stream, writable);

    return new Response(readable, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(total),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=86400",
      },
    });
  });

  app.get("/media/download/:filename", async (c) => {
    const filename = c.req.param("filename");
    if (isInvalidFilename(filename)) {
      return c.json({ error: "invalid filename" }, 400);
    }
    const filePath = path.join(ctx.dataDir, "generated", filename);

    let stat;
    try { stat = fs.statSync(filePath); } catch { return c.json({ error: "not found" }, 404); }

    const ext = path.extname(filename).slice(1);
    const mime = MIME[ext] || "application/octet-stream";
    const stream = fs.createReadStream(filePath);
    const { readable, writable } = new TransformStream();
    streamPipe(stream, writable);

    return new Response(readable, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="${safeDownloadName(filename)}"`,
        "Cache-Control": "no-store",
      },
    });
  });

  // Provider summary for Media settings tab
  app.get("/providers", async (c) => {
    try {
      const agentId = c.req.query("agentId") || c.get("agentId") || null;
      const config = createScopedConfigAccessor(ctx, agentId);
      const [
        { models: imageModels },
        { models: audioModels },
        { models: musicModels },
        { providers: catalog },
      ] = await Promise.all([
        safeBusRequest(ctx, "provider:models-by-type", { type: "image" }, { models: [] }),
        safeBusRequest(ctx, "provider:models-by-type", { type: "audio" }, { models: [] }),
        safeBusRequest(ctx, "provider:models-by-type", { type: "music" }, { models: [] }),
        safeBusRequest(ctx, "provider:catalog", {}, { providers: [] }),
      ]);
      const providers = buildMediaProviders({
        catalog: catalog || [],
        imageModels: imageModels || [],
        audioModels: audioModels || [],
        musicModels: musicModels || [],
      });
      return c.json({ providers, config: config.get() || {} });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Save plugin config (default model, provider defaults)
  app.put("/config", async (c) => {
    try {
      const agentId = c.req.query("agentId") || c.get("agentId") || null;
      const config = createScopedConfigAccessor(ctx, agentId);
      const body = await strictJson(c);
      for (const [key, value] of Object.entries(body)) {
        config.set(key, value);
      }
      return c.json({ ok: true });
    } catch (err) {
      if (isInvalidJsonBodyError(err)) return routeError(c, err);
      return c.json({ error: err.message }, 500);
    }
  });
}

/** Pipe a Node.js Readable into a Web WritableStream */
function streamPipe(nodeStream, writable) {
  const writer = writable.getWriter();
  nodeStream.on("data", (chunk) => writer.write(chunk));
  nodeStream.on("end", () => writer.close());
  nodeStream.on("error", () => writer.close());
}
