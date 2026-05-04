import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const OPENMONTAGE_CACHE_VERSION = 1;

function pathExists(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function findSourceRoot(rootDir) {
  const candidates = [
    process.env.OPENMONTAGE_SOURCE_ROOT,
    path.join(rootDir, "OpenMontage-main"),
    path.join(path.resolve(rootDir, ".."), "OpenMontage-main"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (
      pathExists(path.join(candidate, "AGENT_GUIDE.md"))
      && pathExists(path.join(candidate, "render_demo.py"))
      && pathExists(path.join(candidate, "remotion-composer", "package.json"))
    ) {
      return candidate;
    }
  }
  return "";
}

function shouldIncludeOpenMontagePath(sourceRoot, src) {
  const EXCLUDED_DIRS = new Set([
    ".git",
    ".github",
    ".claude",
    ".cursor",
    "__pycache__",
    "tests",
  ]);

  const rel = path.relative(sourceRoot, src);
  if (!rel) return true;

  const normalized = rel.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts.some((part) => EXCLUDED_DIRS.has(part))) return false;
  if (normalized.startsWith("projects/demos/renders/")) return false;
  if (normalized.includes("/__pycache__/")) return false;
  return true;
}

function hashTree(rootDir, shouldInclude, extra = {}) {
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify(extra));

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (!shouldInclude(rootDir, fullPath)) continue;

      const rel = path.relative(rootDir, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        hash.update(`dir:${rel}\n`);
        walk(fullPath);
        continue;
      }

      const stat = fs.statSync(fullPath);
      hash.update(`file:${rel}:${stat.size}:${stat.mtimeMs}\n`);
    }
  }

  walk(rootDir);
  return hash.digest("hex");
}

function loadManifest(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function ensureRemotionDependencies(sourceRoot, nodeBin, npmCli, env) {
  const composerDir = path.join(sourceRoot, "remotion-composer");
  const cliEntry = path.join(composerDir, "node_modules", "@remotion", "cli", "remotion-cli.js");
  if (pathExists(cliEntry)) return false;

  console.log("[prepare-openmontage] installing remotion-composer dependencies...");
  execFileSync(nodeBin, [npmCli, "install"], {
    cwd: composerDir,
    stdio: "inherit",
    env,
  });
  return true;
}

function copyRuntime(sourceRoot, runtimeRoot) {
  fs.cpSync(sourceRoot, runtimeRoot, {
    recursive: true,
    force: true,
    filter: (src) => shouldIncludeOpenMontagePath(sourceRoot, src),
  });
}

export function prepareOpenMontageRuntime({ rootDir, outDir, nodeBin, npmCli, env }) {
  const sourceRoot = findSourceRoot(rootDir);
  if (!sourceRoot) {
    return { prepared: false, reason: "source-missing" };
  }

  const dependenciesInstalled = ensureRemotionDependencies(sourceRoot, nodeBin, npmCli, env);
  const runtimeRoot = path.join(outDir, "openmontage-runtime");

  const cacheRoot = path.join(rootDir, ".cache", "runtime-prep", "openmontage");
  const cacheRuntimeRoot = path.join(cacheRoot, "runtime");
  const manifestPath = path.join(cacheRoot, "manifest.json");
  const fingerprint = hashTree(sourceRoot, shouldIncludeOpenMontagePath, {
    cacheVersion: OPENMONTAGE_CACHE_VERSION,
    runtimeRoot,
  });
  const manifest = loadManifest(manifestPath);

  if (
    !dependenciesInstalled
    && manifest?.fingerprint === fingerprint
    && manifest?.runtimeRoot === runtimeRoot
    && pathExists(path.join(cacheRuntimeRoot, "remotion-composer", "package.json"))
  ) {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    ensureDir(path.dirname(runtimeRoot));
    fs.cpSync(cacheRuntimeRoot, runtimeRoot, { recursive: true, force: true });
    console.log("[prepare-openmontage] using cached runtime");
    return { prepared: true, sourceRoot, runtimeRoot, cached: true };
  }

  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  ensureDir(runtimeRoot);
  copyRuntime(sourceRoot, runtimeRoot);

  fs.rmSync(cacheRuntimeRoot, { recursive: true, force: true });
  ensureDir(cacheRoot);
  fs.cpSync(runtimeRoot, cacheRuntimeRoot, { recursive: true, force: true });
  fs.writeFileSync(manifestPath, JSON.stringify({
    cacheVersion: OPENMONTAGE_CACHE_VERSION,
    fingerprint,
    runtimeRoot,
  }, null, 2));

  console.log("[prepare-openmontage] bundled runtime ready");
  return { prepared: true, sourceRoot, runtimeRoot, cached: false };
}
