#!/usr/bin/env node
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { pipeline } from "stream/promises";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import tarStream from "tar-stream";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {
  getLinuxExecutableName,
  getLinuxBinaryName,
  buildLinuxLauncher,
} = require("./linux-launcher.cjs");
const ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT, "dist");
const DEFAULT_INPUT_DIR = path.join(DIST_DIR, "linux-unpacked");
const args = new Set(process.argv.slice(2));

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
const productName = pkg.build?.productName || "Hanako";
const packageName = String(pkg.name || productName).toLowerCase().replace(/[^a-z0-9+.-]+/g, "-");
const desktopName = String(pkg.desktopName || `${packageName}.desktop`);
const linuxWmClass = String(pkg.build?.linux?.desktop?.entry?.StartupWMClass || pkg.build?.linux?.desktop?.entry?.["X-GNOME-WMClass"] || packageName);
const linuxIconSizes = [16, 24, 32, 48, 64, 128, 256, 512];
const version = String(pkg.version || "0.0.0");
const sourceDir = DEFAULT_INPUT_DIR;
const debArch = "amd64";
const tarArch = "x64";
const installRoot = `/opt/${packageName}`;
const appExecutable = getLinuxExecutableName(pkg);
const appExecutableBinary = getLinuxBinaryName(appExecutable);

const outputTar = path.join(DIST_DIR, `${productName}-${version}-Linux-${tarArch}.tar.gz`);
const outputDeb = path.join(DIST_DIR, `${productName}-${version}-Linux-${debArch}.deb`);
const workDir = path.join(DIST_DIR, ".linux-package");
const controlTar = path.join(workDir, "control.tar.gz");
const dataTar = path.join(workDir, "data.tar.gz");
const controlStageDir = path.join(workDir, "control-stage");
const dataStageDir = path.join(workDir, "data-stage");

const makeTar = args.has("--tar") || args.has("--all") || process.argv.length <= 2;
const makeDeb = args.has("--deb") || args.has("--all") || process.argv.length <= 2;

const exactExecutableFiles = new Set([
  appExecutable,
  appExecutableBinary,
  "chrome_crashpad_handler",
  "resources/server/hana-server",
  "resources/server/node",
]);

function looksLikeScript(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(2);
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    return bytesRead === 2 && header.toString("utf8") === "#!";
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function modeForRelative(rel, { deb = false } = {}) {
  const posix = toPosix(rel);
  if (posix === "chrome-sandbox") return deb ? 0o4755 : 0o755;
  if (exactExecutableFiles.has(posix)) return 0o755;
  if (posix.endsWith(".sh") || posix.endsWith(".AppRun")) return 0o755;
  return 0o644;
}

function ensureLinuxUnpacked() {
  const required = [
    appExecutable,
    "chrome-sandbox",
    "chrome_crashpad_handler",
    "resources/app.asar",
    "resources/server/hana-server",
    "resources/server/node",
    "resources/server/bootstrap.js",
  ];
  const launcherPath = path.join(sourceDir, appExecutable);
  if (looksLikeScript(launcherPath)) required.push(appExecutableBinary);
  const missing = required.filter((item) => !fs.existsSync(path.join(sourceDir, ...item.split("/"))));
  const hasServerEntry = [
    "resources/server/server/index.js",
    "resources/server/bundle/index.js",
  ].some((item) => fs.existsSync(path.join(sourceDir, ...item.split("/"))));
  if (!hasServerEntry) {
    missing.push("resources/server/server/index.js or resources/server/bundle/index.js");
  }
  if (missing.length > 0) {
    throw new Error(`linux-unpacked is incomplete. Missing: ${missing.join(", ")}`);
  }
}

function collectEntries(root) {
  const entries = [];
  const visit = (abs, rel) => {
    const stat = fs.lstatSync(abs);
    if (rel) {
      entries.push({ abs, rel: toPosix(rel), stat });
    }
    if (!stat.isDirectory()) return;
    const children = fs.readdirSync(abs).sort((a, b) => a.localeCompare(b));
    for (const child of children) {
      visit(path.join(abs, child), rel ? path.join(rel, child) : child);
    }
  };
  visit(root, "");
  return entries;
}

function entryHeader({ name, stat, mode, type = "file", linkname = "" }) {
  const mtime = stat?.mtime || new Date(0);
  return {
    name,
    type,
    mode,
    uid: 0,
    gid: 0,
    uname: "root",
    gname: "root",
    mtime,
    size: type === "file" ? stat.size : 0,
    linkname,
  };
}

async function addDirectory(pack, name, mode = 0o755) {
  const normalized = name.endsWith("/") ? name : `${name}/`;
  await new Promise((resolve, reject) => {
    pack.entry(entryHeader({ name: normalized, mode, type: "directory" }), (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function addBuffer(pack, name, content, mode = 0o644) {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf-8");
  await new Promise((resolve, reject) => {
    pack.entry({
      name,
      type: "file",
      mode,
      uid: 0,
      gid: 0,
      uname: "root",
      gname: "root",
      mtime: new Date(0),
      size: body.length,
    }, body, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function addFile(pack, source, name, mode) {
  const stat = fs.statSync(source);
  await new Promise((resolve, reject) => {
    const entry = pack.entry(entryHeader({ name, stat, mode }), (err) => {
      if (err) reject(err);
      else resolve();
    });
    fs.createReadStream(source)
      .on("error", reject)
      .pipe(entry)
      .on("error", reject);
  });
}

async function addSymlink(pack, name, linkname) {
  await new Promise((resolve, reject) => {
    pack.entry({
      name,
      type: "symlink",
      linkname,
      mode: 0o777,
      uid: 0,
      gid: 0,
      uname: "root",
      gname: "root",
      mtime: new Date(0),
      size: 0,
    }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function writeTarGz(output, writeEntries) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const pack = tarStream.pack();
  const gzip = zlib.createGzip({ level: 9 });
  const out = fs.createWriteStream(output);
  const done = pipeline(pack, gzip, out);
  await writeEntries(pack);
  pack.finalize();
  await done;
}

async function createStandaloneTar() {
  const entries = collectEntries(sourceDir);
  const rootName = `${productName}-${version}-Linux-${tarArch}`;
  await writeTarGz(outputTar, async (pack) => {
    await addDirectory(pack, rootName);
    for (const entry of entries) {
      const name = `${rootName}/${entry.rel}`;
      if (entry.stat.isDirectory()) {
        await addDirectory(pack, name);
      } else if (entry.stat.isFile()) {
        await addFile(pack, entry.abs, name, modeForRelative(entry.rel));
      }
    }
    await addBuffer(pack, `${rootName}/run-hanako.sh`, [
      "#!/bin/sh",
      "unset ELECTRON_RUN_AS_NODE",
      'DIR="$(cd "$(dirname "$0")" && pwd)"',
      'exec "$DIR/hanako" "$@"',
      "",
    ].join("\n"), 0o755);
    await addBuffer(pack, `${rootName}/README-Linux.txt`, [
      "Hanako Linux desktop package",
      "",
      "Run from an extracted directory:",
      "  ./run-hanako.sh",
      "",
      "If your distribution blocks Chromium user namespaces, install the .deb package instead.",
      "The .deb package installs chrome-sandbox with the required root-owned setuid permissions.",
      "",
    ].join("\n"));
  });
  console.log(`[linux-package] wrote ${path.relative(ROOT, outputTar)}`);
}

function desktopFile() {
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${productName}`,
    `Comment=${pkg.description || "Personal AI agent"}`,
    `Exec=/usr/bin/${appExecutable} %U`,
    `Icon=${packageName}`,
    "Terminal=false",
    "Categories=Utility;Office;",
    `StartupWMClass=${linuxWmClass}`,
    `X-GNOME-WMClass=${linuxWmClass}`,
    "",
  ].join("\n");
}

function wrapperScript() {
  return buildLinuxLauncher({
    productName,
    binaryName: appExecutableBinary,
    appDir: installRoot,
    desktopName,
  });
}

function maintainerScript() {
  return [
    "#!/bin/sh",
    "set -e",
    "if command -v update-desktop-database >/dev/null 2>&1; then",
    "  update-desktop-database -q /usr/share/applications || true",
    "fi",
    "if command -v gtk-update-icon-cache >/dev/null 2>&1; then",
    "  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true",
    "fi",
    "exit 0",
    "",
  ].join("\n");
}

function installedSizeKb() {
  let total = 0;
  for (const entry of collectEntries(sourceDir)) {
    if (entry.stat.isFile()) total += entry.stat.size;
  }
  total += Buffer.byteLength(desktopFile());
  total += Buffer.byteLength(wrapperScript());
  const iconPath = path.join(ROOT, "desktop", "src", "icon.png");
  if (fs.existsSync(iconPath)) total += fs.statSync(iconPath).size * (linuxIconSizes.length + 1);
  return Math.ceil(total / 1024);
}

function controlFile() {
  return [
    `Package: ${packageName}`,
    `Version: ${version}`,
    "Section: utils",
    "Priority: optional",
    `Architecture: ${debArch}`,
    `Maintainer: ${pkg.build?.linux?.maintainer || "liliMozi <noreply@example.com>"}`,
    `Installed-Size: ${installedSizeKb()}`,
    "Depends: libgtk-3-0 | libgtk-3-0t64, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libdrm2, libgbm1, libasound2 | libasound2t64",
    `Homepage: ${pkg.homepage || "https://github.com/liliMozi/openhanako"}`,
    `Description: ${productName} desktop application`,
    ` ${pkg.description || "Personal AI agent with memory and workflow support."}`,
    "",
  ].join("\n");
}

async function createControlTar() {
  fs.rmSync(controlStageDir, { recursive: true, force: true });
  fs.mkdirSync(controlStageDir, { recursive: true });
  fs.writeFileSync(path.join(controlStageDir, "control"), controlFile(), "utf-8");
  fs.writeFileSync(path.join(controlStageDir, "postinst"), maintainerScript(), "utf-8");
  fs.writeFileSync(path.join(controlStageDir, "postrm"), maintainerScript(), "utf-8");
  fs.chmodSync(path.join(controlStageDir, "control"), 0o644);
  fs.chmodSync(path.join(controlStageDir, "postinst"), 0o755);
  fs.chmodSync(path.join(controlStageDir, "postrm"), 0o755);
  execFileSync("tar", [
    "--format=gnu",
    "--sort=name",
    "--mtime=@0",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    "-czf",
    controlTar,
    "-C",
    controlStageDir,
    ".",
  ]);
}

async function createDataTar() {
  const entries = collectEntries(sourceDir);
  const iconPath = path.join(ROOT, "desktop", "src", "icon.png");
  fs.rmSync(dataStageDir, { recursive: true, force: true });
  fs.mkdirSync(dataStageDir, { recursive: true });

  const ensureStageDir = (relativePath, mode = 0o755) => {
    const fullPath = path.join(dataStageDir, ...relativePath.split("/"));
    fs.mkdirSync(fullPath, { recursive: true });
    fs.chmodSync(fullPath, mode);
  };

  const writeStageFile = (relativePath, content, mode = 0o644) => {
    const fullPath = path.join(dataStageDir, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, typeof content === "string" ? "utf-8" : undefined);
    fs.chmodSync(fullPath, mode);
  };

  const copyStageFile = (source, relativePath, mode) => {
    const fullPath = path.join(dataStageDir, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.copyFileSync(source, fullPath);
    fs.chmodSync(fullPath, mode);
  };

  const iconDirs = linuxIconSizes.flatMap((size) => [
    `usr/share/icons/hicolor/${size}x${size}`,
    `usr/share/icons/hicolor/${size}x${size}/apps`,
  ]);
  const dirs = [
    "opt",
    `opt/${packageName}`,
    "usr",
    "usr/bin",
    "usr/share",
    "usr/share/applications",
    "usr/share/icons",
    "usr/share/icons/hicolor",
    ...iconDirs,
    "usr/share/pixmaps",
    "usr/share/doc",
    `usr/share/doc/${packageName}`,
  ];
  for (const dir of dirs) ensureStageDir(dir);

  for (const entry of entries) {
    const name = `opt/${packageName}/${entry.rel}`;
    if (entry.stat.isDirectory()) {
      ensureStageDir(name);
    } else if (entry.stat.isFile()) {
      copyStageFile(entry.abs, name, modeForRelative(entry.rel, { deb: true }));
    }
  }

  writeStageFile(`usr/bin/${appExecutable}`, wrapperScript(), 0o755);
  writeStageFile(`usr/share/applications/${packageName}.desktop`, desktopFile(), 0o644);
  if (fs.existsSync(iconPath)) {
    for (const size of linuxIconSizes) {
      copyStageFile(iconPath, `usr/share/icons/hicolor/${size}x${size}/apps/${packageName}.png`, 0o644);
    }
    copyStageFile(iconPath, `usr/share/pixmaps/${packageName}.png`, 0o644);
  }
  writeStageFile(`usr/share/doc/${packageName}/copyright`, [
    `Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/`,
    `Upstream-Name: ${productName}`,
    `Source: ${pkg.homepage || "https://github.com/liliMozi/openhanako"}`,
    "",
    "Files: *",
    `Copyright: ${new Date().getFullYear()} ${pkg.author?.name || "liliMozi"}`,
    `License: ${pkg.license || "Apache-2.0"}`,
    "",
  ].join("\n"), 0o644);

  execFileSync("tar", [
    "--format=gnu",
    "--sort=name",
    "--mtime=@0",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    "-czf",
    dataTar,
    "-C",
    dataStageDir,
    ".",
  ]);
}

function arHeader(name, size, mode = "100644") {
  const header = [
    `${name}/`.padEnd(16, " "),
    String(Math.floor(Date.now() / 1000)).padEnd(12, " "),
    "0".padEnd(6, " "),
    "0".padEnd(6, " "),
    mode.padEnd(8, " "),
    String(size).padEnd(10, " "),
    "`\n",
  ].join("");
  return Buffer.from(header, "ascii");
}

async function writeStreamChunk(stream, chunk) {
  if (stream.write(chunk)) return;
  await new Promise((resolve, reject) => {
    stream.once("drain", resolve);
    stream.once("error", reject);
  });
}

async function writeArBuffer(stream, name, content) {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf-8");
  await writeStreamChunk(stream, arHeader(name, body.length));
  await writeStreamChunk(stream, body);
  if (body.length % 2 === 1) await writeStreamChunk(stream, Buffer.from("\n"));
}

async function writeArFile(stream, name, filePath) {
  const stat = fs.statSync(filePath);
  await writeStreamChunk(stream, arHeader(name, stat.size));
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .on("error", reject)
      .on("end", resolve)
      .pipe(stream, { end: false });
  });
  if (stat.size % 2 === 1) await writeStreamChunk(stream, Buffer.from("\n"));
}

async function createDeb() {
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  await createControlTar();
  await createDataTar();

  const out = fs.createWriteStream(outputDeb);
  await writeStreamChunk(out, Buffer.from("!<arch>\n", "ascii"));
  await writeArBuffer(out, "debian-binary", "2.0\n");
  await writeArFile(out, "control.tar.gz", controlTar);
  await writeArFile(out, "data.tar.gz", dataTar);
  out.end();
  await new Promise((resolve, reject) => {
    out.once("finish", resolve);
    out.once("error", reject);
  });
  console.log(`[linux-package] wrote ${path.relative(ROOT, outputDeb)}`);
}

ensureLinuxUnpacked();
if (makeTar) await createStandaloneTar();
if (makeDeb) await createDeb();
