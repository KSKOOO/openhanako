import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildVideoProviderEnv, resolveRuntimeOptions } from "./runtime-options.js";
import { findBundledOpenMontageRoot, withBundledFfmpegInPath } from "./runtime-deps.js";

const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".mkv"]);
const EXTRA_FILE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".srt", ".vtt", ".txt", ".md", ".json"]);

export class OpenMontageRunner {
  constructor({ dataDir, generatedDir, store, bus, log, pluginCtx }) {
    this._dataDir = dataDir;
    this._generatedDir = generatedDir;
    this._store = store;
    this._bus = bus;
    this._log = log;
    this._pluginCtx = pluginCtx;
    this._active = new Map();
  }

  recoverPending() {
    for (const task of this._store.listPending()) {
      this._failTask(task.taskId, "OpenMontage task interrupted by restart");
    }
  }

  async submit(task, runtimeOverrides = {}) {
    const runtime = this._getRuntimeSpec();
    if (!runtime.command) {
      await this._failTask(task.taskId, "OpenMontage runtime is not available");
      return;
    }

    const workDir = path.join(this._generatedDir, task.taskId);
    const jobsDir = path.join(this._dataDir, "jobs");
    const taskFile = path.join(jobsDir, `${task.taskId}.json`);
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(jobsDir, { recursive: true });
    fs.writeFileSync(taskFile, JSON.stringify(task, null, 2), "utf8");

    const args = [...runtime.prefixArgs, ...this._buildArgs(task, taskFile, workDir)];
    const child = spawn(runtime.command, args, {
      cwd: this._pluginCtx.pluginDir,
      env: this._buildRuntimeEnv(task, taskFile, workDir, runtimeOverrides),
      windowsHide: true,
      stdio: "ignore",
    });

    const timeoutMs = this._getRuntimeTimeoutMs();
    const timeout = timeoutMs > 0
      ? setTimeout(async () => {
          this._active.delete(task.taskId);
          killProcessTree(child);
          if (this._store.get(task.taskId)?.status === "pending") {
            await this._failTask(task.taskId, `OpenMontage runtime timed out after ${timeoutMs}ms`);
          }
        }, timeoutMs)
      : null;
    timeout?.unref?.();

    this._active.set(task.taskId, { child, timeout });

    child.on("error", async (err) => {
      if (timeout) clearTimeout(timeout);
      this._active.delete(task.taskId);
      await this._failTask(task.taskId, `OpenMontage runtime failed to start: ${err.message}`);
    });

    child.on("exit", async (code) => {
      if (timeout) clearTimeout(timeout);
      this._active.delete(task.taskId);
      if (this._store.get(task.taskId)?.status !== "pending") return;
      if (code !== 0) {
        await this._failTask(task.taskId, `OpenMontage runtime exited with code ${code}`);
        return;
      }
      const files = this._materializeOutputFiles(task.taskId, workDir);
      if (files.length === 0) {
        await this._failTask(task.taskId, "OpenMontage finished but no output media was found");
        return;
      }

      this._store.update(task.taskId, {
        status: "done",
        files,
        completedAt: new Date().toISOString(),
      });
      this._bus.request("task:remove", { taskId: task.taskId }).catch(() => {});
      await this._bus.request("deferred:resolve", { taskId: task.taskId, files });
    });
  }

  abort(taskId) {
    const active = this._active.get(taskId);
    if (active) {
      if (active.timeout) clearTimeout(active.timeout);
      killProcessTree(active.child);
      this._active.delete(taskId);
    }
    this._store.update(taskId, {
      status: "cancelled",
      failReason: "user cancelled",
      completedAt: new Date().toISOString(),
    });
    this._bus.request("deferred:abort", { taskId, reason: "user cancelled" }).catch(() => {});
    this._bus.request("task:remove", { taskId }).catch(() => {});
  }

  dispose() {
    for (const [taskId, active] of this._active.entries()) {
      if (active.timeout) clearTimeout(active.timeout);
      killProcessTree(active.child);
      this._active.delete(taskId);
    }
  }

  _getRuntimeSpec() {
    const configured = String(
      this._pluginCtx.config.get("runtimeCommand")
      || process.env.OPENMONTAGE_CMD
      || ""
    ).trim();

    if (configured) return { command: configured, prefixArgs: [] };

    const wrapper = path.join(this._pluginCtx.pluginDir, "bin", "openmontage-wrapper.mjs");
    if (!fs.existsSync(wrapper)) return { command: "", prefixArgs: [] };
    return { command: process.execPath, prefixArgs: [wrapper] };
  }

  _buildArgs(task, taskFile, outputDir) {
    const template = (
      this._pluginCtx.config.get("runtimeArgsTemplate")
      || process.env.OPENMONTAGE_ARGS
      || '--task-file "{taskFile}" --output-dir "{outputDir}" --task-id "{taskId}"'
    );
    const replaced = String(template)
      .replaceAll("{taskFile}", taskFile)
      .replaceAll("{outputDir}", outputDir)
      .replaceAll("{taskId}", task.taskId)
      .replaceAll("{prompt}", task.prompt);
    return parseArgs(replaced);
  }

  _buildRuntimeEnv(task, taskFile, outputDir, runtimeOverrides = {}) {
    const runtimeOptions = resolveRuntimeOptions({
      taskParams: task.params || {},
      runtimeOverrides,
      config: this._pluginCtx.config,
      env: process.env,
    });
    const rawEnv = {
      ...process.env,
      OPENMONTAGE_TASK_FILE: taskFile,
      OPENMONTAGE_OUTPUT_DIR: outputDir,
      OPENMONTAGE_TASK_ID: task.taskId,
      OPENMONTAGE_PROMPT: task.prompt,
      OPENMONTAGE_ASSETS_DIR: String(task.params?.assetsDir || ""),
      OPENMONTAGE_ASPECT_RATIO: String(task.params?.aspectRatio || ""),
      OPENMONTAGE_AGENT_CMD: String(
        this._pluginCtx.config.get("agentCommand")
        || process.env.OPENMONTAGE_AGENT_CMD
        || ""
      ),
      OPENMONTAGE_AGENT_ARGS: String(
        this._pluginCtx.config.get("agentArgsTemplate")
        || process.env.OPENMONTAGE_AGENT_ARGS
        || ""
      ),
      OPENMONTAGE_ROOT: String(
        this._pluginCtx.config.get("openMontageRoot")
        || process.env.OPENMONTAGE_ROOT
        || detectDefaultOpenMontageRoot()
        || ""
      ),
      OPENMONTAGE_DEMO: String(
        this._pluginCtx.config.get("demoName")
        || process.env.OPENMONTAGE_DEMO
        || ""
      ),
      OPENMONTAGE_DIRECT_REMOTION_RENDERER: String(
        this._pluginCtx.config.get("directRemotionRenderer")
        || process.env.OPENMONTAGE_DIRECT_REMOTION_RENDERER
        || ""
      ),
      OPENMONTAGE_DIRECT_REMOTION_TIMEOUT_MS: String(
        this._pluginCtx.config.get("directRemotionTimeoutMs")
        || process.env.OPENMONTAGE_DIRECT_REMOTION_TIMEOUT_MS
        || ""
      ),
      OPENMONTAGE_DIRECT_REMOTION_PREFLIGHT_MS: String(
        this._pluginCtx.config.get("directRemotionPreflightMs")
        || process.env.OPENMONTAGE_DIRECT_REMOTION_PREFLIGHT_MS
        || ""
      ),
      ...buildVideoProviderEnv(runtimeOptions),
    };
    return withBundledFfmpegInPath(rawEnv);
  }

  _getRuntimeTimeoutMs() {
    const raw = this._pluginCtx.config.get("runtimeTimeoutMs") || process.env.OPENMONTAGE_TIMEOUT_MS || "";
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return 30 * 60 * 1000;
  }

  _materializeOutputFiles(taskId, outputDir) {
    if (!fs.existsSync(outputDir)) return [];
    const collected = [];
    walkFiles(outputDir, (fullPath) => {
      const ext = path.extname(fullPath).toLowerCase();
      if (!VIDEO_EXTS.has(ext) && !EXTRA_FILE_EXTS.has(ext)) return;
      const targetName = `${taskId}-${path.basename(fullPath)}`;
      const targetPath = path.join(this._generatedDir, targetName);
      fs.copyFileSync(fullPath, targetPath);
      collected.push(targetName);
    });
    collected.sort((a, b) => {
      const aVideo = VIDEO_EXTS.has(path.extname(a).toLowerCase());
      const bVideo = VIDEO_EXTS.has(path.extname(b).toLowerCase());
      if (aVideo && !bVideo) return -1;
      if (!aVideo && bVideo) return 1;
      return a.localeCompare(b);
    });
    return collected;
  }

  async _failTask(taskId, reason) {
    this._store.update(taskId, {
      status: "failed",
      failReason: reason,
      completedAt: new Date().toISOString(),
    });
    this._bus.request("task:remove", { taskId }).catch(() => {});
    await this._bus.request("deferred:fail", {
      taskId,
      error: { message: reason },
    });
  }
}

function parseArgs(raw) {
  const result = [];
  const regex = /[^\s"]+|"([^"]*)"/g;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    result.push(match[1] ?? match[0]);
  }
  return result;
}

function walkFiles(dirPath, onFile) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) walkFiles(fullPath, onFile);
    else if (entry.isFile()) onFile(fullPath);
  }
}

function killProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.on("error", () => {
        try { child.kill(); } catch {}
      });
      return;
    } catch {
      try { child.kill(); } catch {}
      return;
    }
  }
  try { child.kill("SIGTERM"); } catch {}
}

function detectDefaultOpenMontageRoot() {
  return findBundledOpenMontageRoot() || "";
}
