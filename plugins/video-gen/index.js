import fs from "node:fs/promises";
import path from "node:path";

export default class VideoGenPlugin {
  async onload() {
    const { dataDir, log, bus } = this.ctx;

    // 确保数据目录存在
    await fs.mkdir(path.join(dataDir, "tasks"), { recursive: true });
    await fs.mkdir(path.join(dataDir, "videos"), { recursive: true });

    // 注册任务处理器
    this.register(
      bus.handle("video-gen:get-task", async (payload) => {
        const taskId = payload?.taskId;
        if (!taskId) return { error: "Missing taskId" };

        try {
          const taskFile = path.join(dataDir, "tasks", `${taskId}.json`);
          const content = await fs.readFile(taskFile, "utf-8");
          return JSON.parse(content);
        } catch (error) {
          return { error: "Task not found" };
        }
      })
    );

    this.register(
      bus.handle("video-gen:list-tasks", async (payload) => {
        const limit = payload?.limit || 20;

        try {
          const tasksDir = path.join(dataDir, "tasks");
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

          // 按创建时间倒序排序
          tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

          return { tasks };
        } catch (error) {
          return { error: error.message };
        }
      })
    );

    log.info("video-gen plugin loaded");
  }

  async onunload() {
    // 清理资源
  }
}
