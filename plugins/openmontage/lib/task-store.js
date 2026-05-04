import fs from "node:fs";
import path from "node:path";

const DEBOUNCE_MS = 300;

export class MontageTaskStore {
  constructor(dataDir) {
    this._dataDir = dataDir;
    this._filePath = path.join(dataDir, "tasks.json");
    this._tasks = new Map();
    this._debounceTimer = null;
    this._load();
  }

  add(task) {
    if (this._tasks.has(task.taskId)) {
      throw new Error(`MontageTaskStore: duplicate taskId "${task.taskId}"`);
    }
    const entry = {
      ...task,
      status: task.status || "pending",
      failReason: task.failReason || null,
      files: task.files || [],
      createdAt: task.createdAt || new Date().toISOString(),
      completedAt: task.completedAt || null,
    };
    this._tasks.set(task.taskId, entry);
    this._scheduleSave();
    return { ...entry };
  }

  update(taskId, patch) {
    const task = this._tasks.get(taskId);
    if (!task) return null;
    Object.assign(task, patch);
    this._scheduleSave();
    return { ...task };
  }

  get(taskId) {
    const task = this._tasks.get(taskId);
    return task ? { ...task } : null;
  }

  getByBatch(batchId) {
    return this._filter((task) => task.batchId === batchId);
  }

  listPending() {
    return this._filter((task) => task.status === "pending");
  }

  destroy() {
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  _filter(predicate) {
    const result = [];
    for (const task of this._tasks.values()) {
      if (predicate(task)) result.push({ ...task });
    }
    return result;
  }

  _load() {
    try {
      if (!fs.existsSync(this._filePath)) return;
      const raw = JSON.parse(fs.readFileSync(this._filePath, "utf8"));
      if (!Array.isArray(raw)) return;
      for (const task of raw) {
        if (task && typeof task.taskId === "string") {
          this._tasks.set(task.taskId, task);
        }
      }
    } catch {
      // Ignore corrupt snapshots and start with an empty task store.
    }
  }

  _scheduleSave() {
    if (this._debounceTimer !== null) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this._writeSync();
    }, DEBOUNCE_MS);
  }

  _writeSync() {
    try {
      fs.mkdirSync(this._dataDir, { recursive: true });
      const tmp = `${this._filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify([...this._tasks.values()]), "utf8");
      fs.renameSync(tmp, this._filePath);
    } catch (err) {
      process.stderr.write(`MontageTaskStore: write failed: ${err.message}\n`);
    }
  }
}
