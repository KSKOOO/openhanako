#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveRuntimeOptions } from "../lib/runtime-options.js";

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseCliArgs(argv);
  const taskFile = args["task-file"] || env.OPENMONTAGE_TASK_FILE;
  const outputDir = args["output-dir"] || env.OPENMONTAGE_OUTPUT_DIR;
  const taskId = args["task-id"] || env.OPENMONTAGE_TASK_ID || "openmontage-task";
  const requestMd = args["request"] || env.OPENMONTAGE_REQUEST_MD || "";
  const openMontageRoot = String(env.OPENMONTAGE_ROOT || "").trim();
  const backend = String(env.OPENMONTAGE_AGENT_BACKEND || "codex").trim().toLowerCase();

  if (!taskFile || !outputDir || !openMontageRoot) {
    console.error("Usage: openmontage-agent-executor --task-file <file> --output-dir <dir> --task-id <id>");
    return 2;
  }

  const task = JSON.parse(fs.readFileSync(taskFile, "utf8"));
  fs.mkdirSync(outputDir, { recursive: true });
  const runtimeOptions = resolveRuntimeOptions({
    taskParams: task.params || {},
    env,
  });

  const failurePath = path.join(outputDir, "OPENMONTAGE_FAILURE.md");
  const summaryPath = path.join(outputDir, "OPENMONTAGE_AGENT_SUMMARY.txt");
  const prompt = buildExecutorPrompt({
    task,
    taskId,
    outputDir,
    requestMd,
    openMontageRoot,
    runtimeOptions,
    env,
  });

  const resolved = resolveBackend(backend, env);
  if (!resolved) {
    fs.writeFileSync(failurePath, [
      "# OpenMontage Agent Executor Failure",
      "",
      `No supported local executor was found for backend: ${backend}.`,
      "",
      "Tried: codex, claude",
      "",
    ].join("\n"), "utf8");
    return 1;
  }

  const result = await runExecutor(resolved, {
    prompt,
    openMontageRoot,
    outputDir,
    summaryPath,
    env,
  });

  if (result.summary) {
    fs.writeFileSync(summaryPath, result.summary, "utf8");
  }

  if (result.exitCode !== 0) {
    ensureFailureFile(failurePath, `${resolved.name} exited with code ${result.exitCode}.`);
    return result.exitCode;
  }

  if (!hasMediaOutput(outputDir)) {
    ensureFailureFile(failurePath, `${resolved.name} completed but did not produce a media file in ${outputDir}.`);
    return 1;
  }

  const resultJsonPath = path.join(outputDir, "OPENMONTAGE_RESULT.json");
  if (!fs.existsSync(resultJsonPath)) {
    fs.writeFileSync(resultJsonPath, JSON.stringify({
      taskId,
      backend: resolved.name,
      prompt: task.prompt || "",
      outputDir,
      provider: runtimeOptions.provider || null,
      model: runtimeOptions.model || null,
      pipeline: runtimeOptions.pipeline || null,
    }, null, 2), "utf8");
  }

  return 0;
}

export function parseCliArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

export function buildExecutorPrompt({
  task,
  taskId,
  outputDir,
  requestMd,
  openMontageRoot,
  runtimeOptions = {},
  env = process.env,
}) {
  const prompt = String(task.prompt || "").trim();
  const preferenceLines = [];
  if (runtimeOptions.pipeline) preferenceLines.push(`Pipeline hint: ${runtimeOptions.pipeline}`);
  if (runtimeOptions.provider) preferenceLines.push(`Preferred video provider: ${runtimeOptions.provider}`);
  if (runtimeOptions.model) preferenceLines.push(`Preferred video model: ${runtimeOptions.model}`);
  if (runtimeOptions.baseUrl) preferenceLines.push(`Custom API base URL is already injected into the runtime environment: ${runtimeOptions.baseUrl}`);
  if (runtimeOptions.resolution) preferenceLines.push(`Preferred resolution: ${runtimeOptions.resolution}`);
  if (env.OPENMONTAGE_PROVIDER_ENV_KEYS) {
    preferenceLines.push(`Additional runtime env override keys are available: ${env.OPENMONTAGE_PROVIDER_ENV_KEYS}`);
  }

  return [
    "Read AGENT_GUIDE.md and PROJECT_CONTEXT.md before doing anything else.",
    "",
    "You are operating inside the OpenMontage repository to fulfill a real video-production request.",
    "",
    `Task ID: ${taskId}`,
    `User request: ${prompt}`,
    `OpenMontage root: ${openMontageRoot}`,
    `Output directory: ${outputDir}`,
    requestMd ? `Request file: ${requestMd}` : "",
    ...preferenceLines,
    "",
    "Hard requirements:",
    "- Do NOT use the built-in demo render path or demo props.",
    "- Follow OpenMontage pipeline rules honestly.",
    "- Choose the fastest viable pipeline that can satisfy the request with the tools available on this machine.",
    "- If a preferred provider or model is supplied, use it unless it is unavailable; if you must deviate, explain the exact reason in OPENMONTAGE_RESULT.json or OPENMONTAGE_FAILURE.md.",
    "- Use video_selector with preferred_provider when it matches the requested provider instead of silently picking another vendor.",
    "- If a real production render is impossible, write OPENMONTAGE_FAILURE.md into the output directory with exact blockers and recommended next steps, then stop.",
    "- On success, copy the final deliverable into the output directory as final.mp4, final.mov, or final.webm.",
    "- Also write OPENMONTAGE_RESULT.json summarizing pipeline, render_runtime, and important output files.",
    "",
    "You may write temporary project artifacts inside the OpenMontage repo, but the final media file must end up in the output directory.",
  ].filter(Boolean).join("\n");
}

export function resolveBackend(preferred, env = process.env) {
  const order = preferred === "claude"
    ? ["claude", "codex"]
    : ["codex", "claude"];
  for (const name of order) {
    const cmd = resolveCommand(name, env);
    if (!cmd) continue;
    return { name, command: cmd };
  }
  return null;
}

export function resolveCommand(baseName, env = process.env) {
  if (process.platform === "win32" && baseName === "codex") {
    const appData = env.APPDATA || "";
    const nativeCodex = path.join(
      appData,
      "npm",
      "node_modules",
      "@openai",
      "codex",
      "node_modules",
      "@openai",
      "codex-win32-x64",
      "vendor",
      "x86_64-pc-windows-msvc",
      "codex",
      "codex.exe",
    );
    if (fs.existsSync(nativeCodex)) return nativeCodex;
  }

  const pathEntries = String(env.PATH || "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32"
    ? String(env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  const candidates = process.platform === "win32"
    ? [
        ...extensions.map((ext) => `${baseName}${ext.toLowerCase()}`),
        ...extensions.map((ext) => `${baseName}${ext}`),
        baseName,
      ]
    : [baseName];

  for (const dir of pathEntries) {
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
      } catch {
        // Ignore broken PATH entries.
      }
    }
  }
  return "";
}

export async function runExecutor(resolved, { prompt, openMontageRoot, outputDir, summaryPath, env = process.env }) {
  if (resolved.name === "codex") {
    return await runCodex(resolved.command, { prompt, openMontageRoot, outputDir, summaryPath, env });
  }
  return await runClaude(resolved.command, { prompt, openMontageRoot, outputDir, env });
}

export function runCodex(command, { prompt, openMontageRoot, outputDir, summaryPath, env = process.env }) {
  const argv = [
    "exec",
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    "-C", openMontageRoot,
    "--add-dir", outputDir,
    "-o", summaryPath,
    prompt,
  ];
  return run(command, argv, openMontageRoot, { env });
}

export async function runClaude(command, { prompt, openMontageRoot, outputDir, env = process.env }) {
  const argv = [
    "-p",
    "--dangerously-skip-permissions",
    "--add-dir", outputDir,
    prompt,
  ];
  const result = await run(command, argv, openMontageRoot, { captureStdout: true, env });
  return { ...result, summary: result.stdout };
}

export function run(command, argv, cwd, options = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, argv, {
        cwd,
        windowsHide: true,
        shell: false,
        stdio: options.captureStdout ? ["ignore", "pipe", "pipe"] : "inherit",
        env: options.env || process.env,
      });
    } catch (err) {
      resolve({ exitCode: 1, stdout: "", stderr: err.message });
      return;
    }

    let stdout = "";
    let stderr = "";
    if (options.captureStdout) {
      child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    }

    child.on("error", (err) => {
      resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${err.message}` });
    });
    child.on("exit", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

export function hasMediaOutput(dirPath) {
  const mediaExts = new Set([".mp4", ".mov", ".webm", ".mkv", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
  const stack = [dirPath];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (mediaExts.has(path.extname(entry.name).toLowerCase())) return true;
    }
  }
  return false;
}

export function ensureFailureFile(failurePath, reason) {
  if (fs.existsSync(failurePath)) return;
  fs.writeFileSync(failurePath, [
    "# OpenMontage Agent Executor Failure",
    "",
    reason,
    "",
  ].join("\n"), "utf8");
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const current = fileURLToPath(import.meta.url);
  return path.basename(current).toLowerCase() === path.basename(process.argv[1]).toLowerCase();
}

if (isMainModule()) {
  const exitCode = await main();
  process.exit(exitCode);
}
