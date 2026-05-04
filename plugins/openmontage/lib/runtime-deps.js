import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function pathExists(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

function normalizePathValue(value) {
  if (!value) return "";
  try {
    return path.resolve(String(value));
  } catch {
    return String(value);
  }
}

export function getBundledOpenMontageRootCandidates(preferred = "") {
  return [
    preferred,
    process.env.OPENMONTAGE_BUNDLED_ROOT || "",
    path.resolve(HERE, "../../../OpenMontage-main"),
    path.resolve(HERE, "../../../openmontage-runtime"),
    path.resolve(process.cwd(), "openmontage-runtime"),
    path.resolve(process.cwd(), "OpenMontage-main"),
    path.resolve(process.cwd(), "..", "openmontage-runtime"),
    path.resolve(process.cwd(), "..", "OpenMontage-main"),
    process.execPath ? path.join(path.dirname(process.execPath), "openmontage-runtime") : "",
    process.resourcesPath ? path.join(process.resourcesPath, "server", "openmontage-runtime") : "",
  ].filter(Boolean);
}

export function isOpenMontageRoot(candidate) {
  const root = normalizePathValue(candidate);
  return !!root
    && pathExists(path.join(root, "AGENT_GUIDE.md"))
    && pathExists(path.join(root, "render_demo.py"))
    && pathExists(path.join(root, "remotion-composer", "package.json"));
}

export function findBundledOpenMontageRoot(preferred = "") {
  for (const candidate of getBundledOpenMontageRootCandidates(preferred)) {
    if (isOpenMontageRoot(candidate)) return normalizePathValue(candidate);
  }
  return "";
}

export function getBundledFfmpegExecutable() {
  const exeName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const candidates = [
    process.env.OPENMONTAGE_FFMPEG || "",
    path.resolve(HERE, "../../../vendor/ffmpeg-portable/win-x64", exeName),
    path.resolve(HERE, "../../../ffmpeg", exeName),
    path.resolve(process.cwd(), "vendor", "ffmpeg-portable", "win-x64", exeName),
    path.resolve(process.cwd(), "ffmpeg", exeName),
    path.resolve(process.cwd(), "..", "ffmpeg", exeName),
    process.execPath ? path.join(path.dirname(process.execPath), "ffmpeg", exeName) : "",
    process.resourcesPath ? path.join(process.resourcesPath, "server", "ffmpeg", exeName) : "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = normalizePathValue(candidate);
    if (pathExists(resolved)) return resolved;
  }
  return "";
}

export function getBundledPythonExecutable() {
  const candidates = process.platform === "win32"
    ? [
        path.resolve(HERE, "../../../hermes-agent-runtime/python/python.exe"),
        path.resolve(HERE, "../../../hermes-agent-runtime/.venv/Scripts/python.exe"),
        process.execPath ? path.join(path.dirname(process.execPath), "hermes-agent-runtime", "python", "python.exe") : "",
        process.execPath ? path.join(path.dirname(process.execPath), "hermes-agent-runtime", ".venv", "Scripts", "python.exe") : "",
        process.resourcesPath ? path.join(process.resourcesPath, "server", "hermes-agent-runtime", "python", "python.exe") : "",
        process.resourcesPath ? path.join(process.resourcesPath, "server", "hermes-agent-runtime", ".venv", "Scripts", "python.exe") : "",
      ]
    : [
        path.resolve(HERE, "../../../hermes-agent-runtime/python/bin/python"),
        path.resolve(HERE, "../../../hermes-agent-runtime/.venv/bin/python"),
        process.execPath ? path.join(path.dirname(process.execPath), "hermes-agent-runtime", "python", "bin", "python") : "",
        process.execPath ? path.join(path.dirname(process.execPath), "hermes-agent-runtime", ".venv", "bin", "python") : "",
        process.resourcesPath ? path.join(process.resourcesPath, "server", "hermes-agent-runtime", "python", "bin", "python") : "",
        process.resourcesPath ? path.join(process.resourcesPath, "server", "hermes-agent-runtime", ".venv", "bin", "python") : "",
      ];

  for (const candidate of candidates.filter(Boolean)) {
    const resolved = normalizePathValue(candidate);
    if (pathExists(resolved)) return resolved;
  }
  return "";
}

export function withBundledFfmpegInPath(baseEnv = process.env) {
  const ffmpegExecutable = getBundledFfmpegExecutable();
  if (!ffmpegExecutable) return { ...baseEnv };

  const env = { ...baseEnv };
  const ffmpegDir = path.dirname(ffmpegExecutable);
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
  const existingPath = env[pathKey] || env.PATH || "";
  const segments = String(existingPath || "")
    .split(path.delimiter)
    .filter(Boolean);

  const normalizedSegments = segments.map((segment) => normalizePathValue(segment).toLowerCase());
  if (!normalizedSegments.includes(normalizePathValue(ffmpegDir).toLowerCase())) {
    segments.unshift(ffmpegDir);
  }

  if (pathKey !== "PATH") delete env[pathKey];
  env.PATH = segments.join(path.delimiter);
  env.OPENMONTAGE_FFMPEG = ffmpegExecutable;
  return env;
}
