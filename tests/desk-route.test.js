import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

const extractZipMock = vi.fn(async (zipPath, destDir) => {
  const skillDir = path.join(destDir, "sample-skill");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: sample-skill\n---\nfrom: ${zipPath}\n`, "utf-8");
});

vi.mock("../lib/extract-zip.js", () => ({
  extractZip: extractZipMock,
}));

describe("desk route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("desk/install-skill 对 zip/.skill 走 extractZip 抽象，并把解压结果安装到工作区技能目录", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hana-desk-route-"));
    try {
      const cwd = path.join(tempRoot, "workspace");
      fs.mkdirSync(cwd, { recursive: true });
      const zipPath = path.join(tempRoot, "sample-skill.zip");
      fs.writeFileSync(zipPath, "placeholder");

      const syncWorkspaceSkillPaths = vi.fn(async () => {});
      const engine = {
        deskCwd: cwd,
        homeCwd: cwd,
        syncWorkspaceSkillPaths,
      };

      const { createDeskRoute } = await import("../server/routes/desk.js");
      const app = new Hono();
      app.route("/api", createDeskRoute(engine, null));

      const res = await app.request("/api/desk/install-skill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: zipPath, dir: cwd }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, name: "sample-skill" });
      expect(extractZipMock).toHaveBeenCalledTimes(1);
      expect(extractZipMock).toHaveBeenCalledWith(zipPath, expect.stringMatching(/_tmp_/));
      expect(fs.existsSync(path.join(cwd, ".agents", "skills", "sample-skill", "SKILL.md"))).toBe(true);
      expect(syncWorkspaceSkillPaths).toHaveBeenCalledWith(cwd, { reload: true, emitEvent: true, force: true });
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("allows explicit desk dirs from workspace scope and rejects arbitrary siblings", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hana-desk-route-"));
    try {
      const cwd = path.join(tempRoot, "workspace");
      const extra = path.join(tempRoot, "reference");
      const sibling = path.join(tempRoot, "private");
      for (const dir of [cwd, extra, sibling]) fs.mkdirSync(dir, { recursive: true });

      const engine = {
        deskCwd: cwd,
        homeCwd: cwd,
        isApprovedWorkspaceDir: vi.fn((dir) => dir === cwd || dir === extra),
      };

      const { createDeskRoute } = await import("../server/routes/desk.js");
      const app = new Hono();
      app.route("/api", createDeskRoute(engine, null));

      const allowed = await app.request(`/api/desk/files?dir=${encodeURIComponent(extra)}`);
      expect(allowed.status).toBe(200);
      expect((await allowed.json()).basePath).toBe(extra);

      const blocked = await app.request(`/api/desk/files?dir=${encodeURIComponent(sibling)}`);
      expect(await blocked.json()).toHaveProperty("error");
      expect(engine.isApprovedWorkspaceDir).toHaveBeenCalled();
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("allows the app file browser to open persisted workspace history outside the agent sandbox", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hana-desk-route-"));
    try {
      const agentHome = path.join(tempRoot, "hana");
      const selectedWorkspace = path.join(tempRoot, "desktop");
      fs.mkdirSync(agentHome, { recursive: true });
      fs.mkdirSync(selectedWorkspace, { recursive: true });
      fs.writeFileSync(path.join(selectedWorkspace, "visible.txt"), "ok");

      const engine = {
        config: { cwd_history: [selectedWorkspace] },
        deskCwd: agentHome,
        homeCwd: agentHome,
        isApprovedWorkspaceDir: vi.fn(() => false),
      };

      const { createDeskRoute } = await import("../server/routes/desk.js");
      const app = new Hono();
      app.route("/api", createDeskRoute(engine, null));

      const res = await app.request(`/api/desk/files?dir=${encodeURIComponent(selectedWorkspace)}`);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.basePath).toBe(selectedWorkspace);
      expect(data.files.map(f => f.name)).toContain("visible.txt");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
