import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("config workspace routes", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-workspaces-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists a selected workspace into the current agent workspace history", async () => {
    const { createConfigRoute } = await import("../server/routes/config.js");
    const oldWorkspace = path.join(tmpDir, "old");
    const nextWorkspace = path.join(tmpDir, "next");
    fs.mkdirSync(oldWorkspace);
    fs.mkdirSync(nextWorkspace);
    const engine = {
      config: { cwd_history: [oldWorkspace] },
      updateConfig: vi.fn(async (patch) => {
        engine.config = { ...engine.config, ...patch };
      }),
    };
    const app = new Hono();
    app.route("/api", createConfigRoute(engine));

    const res = await app.request("/api/config/workspaces/recent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: nextWorkspace }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cwd_history).toEqual([nextWorkspace, oldWorkspace]);
    expect(engine.updateConfig).toHaveBeenCalledWith({
      cwd_history: [nextWorkspace, oldWorkspace],
    });
  });
});
