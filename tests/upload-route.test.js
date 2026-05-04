import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { countFiles, createUploadRoute } from "../server/routes/upload.js";

function mktemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hana-upload-route-"));
}

describe("upload route", () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      tmpDir = null;
    }
  });

  it("rejects a symlink root path", async () => {
    tmpDir = mktemp();
    const targetFile = path.join(tmpDir, "real.txt");
    const linkPath = path.join(tmpDir, "link.txt");
    fs.writeFileSync(targetFile, "hello", "utf-8");
    fs.symlinkSync(targetFile, linkPath);

    const app = new Hono();
    app.route("/api", createUploadRoute({ hanakoHome: path.join(tmpDir, "hana-home") }));

    const res = await app.request("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: [linkPath] }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.uploads[0]).toMatchObject({
      src: linkPath,
      error: "symlink not allowed",
    });
  });

  it("rejects directories that contain symlinks", async () => {
    tmpDir = mktemp();
    const dirPath = path.join(tmpDir, "cycle");
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(path.join(dirPath, "note.txt"), "hello", "utf-8");
    fs.symlinkSync(dirPath, path.join(dirPath, "loop"));

    const app = new Hono();
    app.route("/api", createUploadRoute({ hanakoHome: path.join(tmpDir, "hana-home") }));

    const res = await app.request("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: [dirPath] }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.uploads[0]).toMatchObject({
      src: dirPath,
      error: "symlink not allowed",
    });
  });

  it("stops counting once the configured file limit is exceeded", async () => {
    tmpDir = mktemp();
    const dirPath = path.join(tmpDir, "many-files");
    fs.mkdirSync(dirPath, { recursive: true });
    for (let i = 0; i < 12; i++) {
      fs.writeFileSync(path.join(dirPath, `f-${i}.txt`), "x", "utf-8");
    }

    const count = await countFiles(dirPath, { limit: 9 });
    expect(count).toBe(10);
  });

  it("upload-blob writes base64 image to uploads dir with sanitized name", async () => {
    tmpDir = mktemp();
    const hanakoHome = path.join(tmpDir, "hana-home");
    const app = new Hono();
    app.route("/api", createUploadRoute({ hanakoHome }));

    // 1x1 PNG
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );

    const res = await app.request("/api/upload-blob", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "shot.png", base64Data: png.toString("base64"), mimeType: "image/png" }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.uploads).toHaveLength(1);
    const up = data.uploads[0];
    expect(up.error).toBeUndefined();
    expect(up.name).toBe("shot.png");
    expect(up.isDirectory).toBe(false);
    expect(fs.existsSync(up.dest)).toBe(true);
    expect(fs.readFileSync(up.dest).equals(png)).toBe(true);
  });

  it("upload-blob rejects non-image mimeType", async () => {
    tmpDir = mktemp();
    const app = new Hono();
    app.route("/api", createUploadRoute({ hanakoHome: path.join(tmpDir, "hana-home") }));

    const res = await app.request("/api/upload-blob", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "evil.exe",
        base64Data: Buffer.from("MZ").toString("base64"),
        mimeType: "application/x-msdownload",
      }),
    });
    const data = await res.json();
    expect(data.uploads[0].error).toBe("unsupported mimeType");
  });

  it("upload-blob rejects image mimeTypes that the chat send path cannot accept", async () => {
    tmpDir = mktemp();
    const app = new Hono();
    app.route("/api", createUploadRoute({ hanakoHome: path.join(tmpDir, "hana-home") }));

    const res = await app.request("/api/upload-blob", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "diagram.svg",
        base64Data: Buffer.from("<svg></svg>").toString("base64"),
        mimeType: "image/svg+xml",
      }),
    });
    const data = await res.json();
    expect(data.uploads[0]).toMatchObject({ error: "unsupported mimeType" });
    expect(data.uploads[0].dest).toBeUndefined();
  });

  it("upload-blob forces extension to match mimeType (defends against name spoofing)", async () => {
    tmpDir = mktemp();
    const hanakoHome = path.join(tmpDir, "hana-home");
    const app = new Hono();
    app.route("/api", createUploadRoute({ hanakoHome }));

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );

    const res = await app.request("/api/upload-blob", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "../../etc/passwd.exe",
        base64Data: png.toString("base64"),
        mimeType: "image/png",
      }),
    });
    const data = await res.json();
    const up = data.uploads[0];
    expect(up.error).toBeUndefined();
    // basename + 强制扩展名
    expect(up.name).toBe("passwd.png");
    // 确保落点在 uploads 目录内
    expect(up.dest.startsWith(path.join(hanakoHome, "uploads"))).toBe(true);
  });

  it("upload-blob rejects oversized blob", async () => {
    tmpDir = mktemp();
    const app = new Hono();
    app.route("/api", createUploadRoute({ hanakoHome: path.join(tmpDir, "hana-home") }));

    // 16 MiB 原始数据会膨胀成超过 20 MiB 的 base64，发送路径会拒绝，上传路径也必须提前拒绝。
    const big = Buffer.alloc(16 * 1024 * 1024);
    const res = await app.request("/api/upload-blob", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "huge.png",
        base64Data: big.toString("base64"),
        mimeType: "image/png",
      }),
    });
    const data = await res.json();
    expect(data.uploads[0].error).toMatch(/too large/);
  });
});
