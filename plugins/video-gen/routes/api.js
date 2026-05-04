import fs from "node:fs/promises";
import path from "node:path";

export default function (app, ctx) {
  const { dataDir, log } = ctx;

  // 获取任务列表
  app.get("/tasks", async (c) => {
    try {
      const limit = parseInt(c.req.query("limit") || "20");
      const tasksDir = path.join(dataDir, "tasks");

      await fs.mkdir(tasksDir, { recursive: true });
      const files = await fs.readdir(tasksDir);
      const tasks = [];

      for (const file of files.slice(0, limit)) {
        if (!file.endsWith(".json")) continue;
        try {
          const content = await fs.readFile(path.join(tasksDir, file), "utf-8");
          tasks.push(JSON.parse(content));
        } catch (error) {
          log.warn(`Failed to read task file: ${file}`);
        }
      }

      tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return c.json({ tasks });
    } catch (error) {
      return c.json({ error: error.message }, 500);
    }
  });

  // 获取单个任务
  app.get("/tasks/:id", async (c) => {
    try {
      const taskId = c.req.param("id");
      const taskFile = path.join(dataDir, "tasks", `${taskId}.json`);
      const content = await fs.readFile(taskFile, "utf-8");
      return c.json(JSON.parse(content));
    } catch (error) {
      return c.json({ error: "Task not found" }, 404);
    }
  });

  // 删除任务
  app.delete("/tasks/:id", async (c) => {
    try {
      const taskId = c.req.param("id");
      const taskFile = path.join(dataDir, "tasks", `${taskId}.json`);
      await fs.unlink(taskFile);
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: "Task not found" }, 404);
    }
  });

  // 获取配置
  app.get("/config", (c) => {
    return c.json({
      provider: ctx.config.get("provider") || "runway",
      defaultDuration: ctx.config.get("defaultDuration") || 5,
      defaultResolution: ctx.config.get("defaultResolution") || "1080p",
      maxConcurrent: ctx.config.get("maxConcurrent") || 2,
      hasRunwayKey: Boolean(ctx.config.get("runwayApiKey")),
      hasPikaKey: Boolean(ctx.config.get("pikaApiKey")),
      hasKlingKey: Boolean(ctx.config.get("klingApiKey")),
      comfyuiUrl: ctx.config.get("comfyuiUrl") || "http://127.0.0.1:8188",
      hasCustomApiUrl: Boolean(ctx.config.get("customApiUrl")),
    });
  });

  // 更新配置
  app.post("/config", async (c) => {
    try {
      const body = await c.req.json();

      if (body.provider) ctx.config.set("provider", body.provider);
      if (body.defaultDuration) ctx.config.set("defaultDuration", body.defaultDuration);
      if (body.defaultResolution) ctx.config.set("defaultResolution", body.defaultResolution);
      if (body.maxConcurrent) ctx.config.set("maxConcurrent", body.maxConcurrent);
      if (body.runwayApiKey !== undefined) ctx.config.set("runwayApiKey", body.runwayApiKey);
      if (body.pikaApiKey !== undefined) ctx.config.set("pikaApiKey", body.pikaApiKey);
      if (body.klingApiKey !== undefined) ctx.config.set("klingApiKey", body.klingApiKey);
      if (body.comfyuiUrl) ctx.config.set("comfyuiUrl", body.comfyuiUrl);
      if (body.customApiUrl !== undefined) ctx.config.set("customApiUrl", body.customApiUrl);
      if (body.customApiKey !== undefined) ctx.config.set("customApiKey", body.customApiKey);

      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: error.message }, 400);
    }
  });

  // 测试连接
  app.post("/test-connection", async (c) => {
    try {
      const body = await c.req.json();
      const provider = body.provider || ctx.config.get("provider");

      let result = { ok: false, message: "" };

      switch (provider) {
        case "comfyui": {
          const comfyuiUrl = body.comfyuiUrl || ctx.config.get("comfyuiUrl");
          try {
            const response = await fetch(`${comfyuiUrl}/system_stats`);
            if (response.ok) {
              result = { ok: true, message: "ComfyUI 连接成功" };
            } else {
              result = { ok: false, message: "ComfyUI 服务不可用" };
            }
          } catch (error) {
            result = { ok: false, message: `无法连接到 ComfyUI: ${error.message}` };
          }
          break;
        }
        case "runway": {
          const apiKey = body.runwayApiKey || ctx.config.get("runwayApiKey");
          if (!apiKey) {
            result = { ok: false, message: "未配置 Runway API Key" };
          } else {
            result = { ok: true, message: "Runway API Key 已配置" };
          }
          break;
        }
        default:
          result = { ok: false, message: `不支持的服务: ${provider}` };
      }

      return c.json(result);
    } catch (error) {
      return c.json({ ok: false, message: error.message }, 500);
    }
  });
}
