#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseResolution, resolveRuntimeOptions } from "../lib/runtime-options.js";
import {
  findBundledOpenMontageRoot,
  getBundledPythonExecutable,
  withBundledFfmpegInPath,
} from "../lib/runtime-deps.js";

const DIRECT_THEMES = {
  "clean-professional": {
    name: "clean-professional",
    backgroundColor: "#FFFFFF",
    textColor: "#1F2937",
    accentColor: "#F59E0B",
  },
  "flat-motion-graphics": {
    name: "flat-motion-graphics",
    backgroundColor: "#0F172A",
    textColor: "#F8FAFC",
    accentColor: "#EC4899",
  },
  "minimalist-diagram": {
    name: "minimalist-diagram",
    backgroundColor: "#FAFAFA",
    textColor: "#1A1A2E",
    accentColor: "#E94560",
  },
  "anime-ghibli": {
    name: "anime-ghibli",
    backgroundColor: "#0A0A1A",
    textColor: "#F0E6D3",
    accentColor: "#FFB347",
  },
};

export async function main(argv = process.argv.slice(2), env = process.env) {
  const preparedEnv = withBundledFfmpegInPath(env);
  const args = parseCliArgs(argv);
  const taskFile = args["task-file"] || preparedEnv.OPENMONTAGE_TASK_FILE;
  const outputDir = args["output-dir"] || preparedEnv.OPENMONTAGE_OUTPUT_DIR;
  const taskId = args["task-id"] || preparedEnv.OPENMONTAGE_TASK_ID || "openmontage-task";

  if (!taskFile || !outputDir) {
    console.error("Usage: openmontage-wrapper --task-file <file> --output-dir <dir> [--task-id <id>]");
    return 2;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const task = JSON.parse(fs.readFileSync(taskFile, "utf8"));
  const selfDir = path.dirname(fileURLToPath(import.meta.url));
  const openMontageRoot = findOpenMontageRoot(preparedEnv.OPENMONTAGE_ROOT || "");
  const runtimeOptions = resolveRuntimeOptions({
    taskParams: task.params || {},
    env: preparedEnv,
  });

  const requestMd = path.join(outputDir, "OPENMONTAGE_REQUEST.md");
  const normalizedJson = path.join(outputDir, "openmontage-task.json");
  fs.writeFileSync(normalizedJson, JSON.stringify(task, null, 2), "utf8");
  fs.writeFileSync(requestMd, buildRequestMarkdown(task, runtimeOptions), "utf8");

  if (shouldAttemptDirectRemotion(runtimeOptions, env)) {
    if (!openMontageRoot) {
      if (runtimeOptions.mode === "direct-remotion") {
        writeFailure(outputDir, "Direct Remotion mode requested, but no OpenMontage repository root was found.");
        return 1;
      }
    } else {
      const directResult = await renderDirectRemotionTask({
        openMontageRoot,
        task,
        taskId,
        outputDir,
        runtimeOptions,
        env: preparedEnv,
      });
      if (directResult.ok) return 0;
      if (runtimeOptions.mode === "direct-remotion") {
        writeFailure(outputDir, directResult.reason || "Direct Remotion rendering failed.");
        return directResult.code || 1;
      }
    }
  } else if (runtimeOptions.mode === "direct-remotion") {
    writeFailure(outputDir, "Direct Remotion mode requested, but direct rendering is disabled.");
    return 1;
  }

  const agentModeRequested = runtimeOptions.mode === "agent";
  const agentCommand = String(preparedEnv.OPENMONTAGE_AGENT_CMD || "").trim();
  if (agentCommand) {
    const agentArgs = buildAgentArgs(preparedEnv.OPENMONTAGE_AGENT_ARGS || "", {
      taskFile,
      outputDir,
      taskId,
      prompt: task.prompt || "",
      requestMd,
      openMontageRoot: preparedEnv.OPENMONTAGE_ROOT || "",
    });
    const code = await run(agentCommand, agentArgs, preparedEnv.OPENMONTAGE_ROOT || process.cwd(), {
      env: preparedEnv,
    });
    if (code === 0 && hasOutputMedia(outputDir)) return 0;
    if (agentModeRequested || hasExecutorFailureArtifacts(outputDir)) return code || 1;
  }

  const builtinExecutor = path.join(selfDir, "openmontage-agent-executor.mjs");
  if (openMontageRoot && preparedEnv.OPENMONTAGE_DISABLE_AGENT !== "1" && fs.existsSync(builtinExecutor)) {
    const code = await run(process.execPath, [
      builtinExecutor,
      "--task-file", taskFile,
      "--output-dir", outputDir,
      "--task-id", taskId,
      ...(requestMd ? ["--request", requestMd] : []),
    ], process.cwd(), {
      env: {
        ...preparedEnv,
        OPENMONTAGE_ROOT: openMontageRoot,
        OPENMONTAGE_AGENT_BACKEND: preparedEnv.OPENMONTAGE_AGENT_BACKEND || "codex",
      },
    });
    if (code === 0 && hasOutputMedia(outputDir)) return 0;
    if (agentModeRequested || hasExecutorFailureArtifacts(outputDir)) return code || 1;
  } else if (agentModeRequested) {
    writeFailure(outputDir, "Agent mode requested, but no built-in or custom OpenMontage agent executor is available.");
    return 1;
  }

  if (runtimeOptions.mode === "auto" && openMontageRoot && preparedEnv.OPENMONTAGE_DISABLE_DEMO !== "1") {
    const demoName = String(preparedEnv.OPENMONTAGE_DEMO || task.params?.demoName || "focusflow-pitch").trim();
    const rendered = await renderOpenMontageDemo(openMontageRoot, demoName, outputDir, preparedEnv);
    if (rendered) return 0;
  }

  if (runtimeOptions.mode !== "auto") {
    writeFailure(outputDir, `${runtimeOptions.mode} mode completed without creating an output video.`);
    return 1;
  }

  fs.writeFileSync(path.join(outputDir, "openmontage-preview.svg"), buildPreviewSvg(task), "utf8");
  fs.writeFileSync(path.join(outputDir, "README.md"), [
    "# OpenMontage runtime not configured",
    "",
    "This task package was generated successfully, but no OpenMontage agent or direct render path completed.",
    "",
    "Set `OPENMONTAGE_AGENT_CMD` for a custom runner, or configure `mode=direct-remotion` / `fastMode=true` to use the local fast path.",
    "",
    "Recommended command contract:",
    "",
    "```text",
    "OPENMONTAGE_AGENT_CMD=<your runner>",
    "OPENMONTAGE_AGENT_ARGS=\"--task-file {taskFile} --output-dir {outputDir} --request {requestMd}\"",
    "```",
    "",
  ].join("\n"), "utf8");

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

export function buildAgentArgs(template, values) {
  const raw = template || '--task-file "{taskFile}" --output-dir "{outputDir}" --request "{requestMd}"';
  const replaced = raw
    .replaceAll("{taskFile}", values.taskFile)
    .replaceAll("{outputDir}", values.outputDir)
    .replaceAll("{taskId}", values.taskId)
    .replaceAll("{prompt}", values.prompt)
    .replaceAll("{requestMd}", values.requestMd)
    .replaceAll("{openMontageRoot}", values.openMontageRoot);
  return parseArgString(replaced);
}

export function parseArgString(raw) {
  const result = [];
  const regex = /[^\s"]+|"([^"]*)"/g;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    result.push(match[1] ?? match[0]);
  }
  return result;
}

export function buildRequestMarkdown(task, runtimeOptions = {}) {
  const params = task.params || {};
  const extraLines = [];
  if (runtimeOptions.mode) extraLines.push(`Mode: ${runtimeOptions.mode}`);
  if (runtimeOptions.fastMode) extraLines.push("Fast mode: true");
  if (runtimeOptions.pipeline) extraLines.push(`Pipeline hint: ${runtimeOptions.pipeline}`);
  if (runtimeOptions.provider) extraLines.push(`Preferred provider: ${runtimeOptions.provider}`);
  if (runtimeOptions.model) extraLines.push(`Preferred model: ${runtimeOptions.model}`);
  if (runtimeOptions.baseUrl) extraLines.push(`Custom base URL: ${runtimeOptions.baseUrl}`);
  if (runtimeOptions.resolution) extraLines.push(`Resolution override: ${runtimeOptions.resolution}`);
  if (runtimeOptions.agentBackend) extraLines.push(`Agent backend: ${runtimeOptions.agentBackend}`);
  if (process.env.OPENMONTAGE_PROVIDER_ENV_KEYS) {
    extraLines.push(`Runtime env override keys: ${process.env.OPENMONTAGE_PROVIDER_ENV_KEYS}`);
  }

  return [
    "# OpenMontage Video Production Request",
    "",
    `Task ID: ${task.taskId || "openmontage-task"}`,
    `Prompt: ${task.prompt || ""}`,
    `Duration: ${params.duration || "unspecified"}`,
    `Aspect ratio: ${params.aspectRatio || "16:9"}`,
    `Resolution: ${params.resolution || runtimeOptions.resolution || "auto"}`,
    `Style: ${params.style || "unspecified"}`,
    `Assets directory: ${params.assetsDir || "unspecified"}`,
    ...extraLines,
    "",
    "## Execution Contract",
    "",
    "Write final media files into the provided output directory.",
    "Prefer mp4/webm for final video. Optional sidecars such as subtitles, storyboard markdown, and metadata JSON are supported.",
    "",
  ].join("\n");
}

export async function run(command, commandArgs, cwd, options = {}) {
  return await new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: cwd || process.cwd(),
      stdio: options.captureStdout ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true,
      shell: false,
      env: options.env || process.env,
    });
    child.on("error", (err) => {
      console.error(err.message);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

export async function runWithTimeout(command, commandArgs, cwd, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 0);
  return await new Promise((resolve) => {
    let settled = false;
    let timeout = null;
    const child = spawn(command, commandArgs, {
      cwd: cwd || process.cwd(),
      stdio: options.captureStdout ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true,
      shell: false,
      env: options.env || process.env,
    });

    let stdout = "";
    let stderr = "";
    if (options.captureStdout) {
      child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    }

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({ stdout, stderr, ...result });
    };

    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        killProcessTree(child);
        finish({ exitCode: 124, timedOut: true });
      }, timeoutMs);
      timeout.unref?.();
    }

    child.on("error", (err) => {
      finish({ exitCode: 1, error: err, stderr: `${stderr}\n${err.message}` });
    });
    child.on("exit", (code) => {
      finish({ exitCode: code ?? 1, timedOut: false });
    });
  });
}

export async function renderDirectRemotionTask({
  openMontageRoot,
  task,
  taskId,
  outputDir,
  runtimeOptions,
  env,
}) {
  if (env.OPENMONTAGE_DIRECT_REMOTION_STUB === "1") {
    const outputPath = path.join(outputDir, "final.mp4");
    fs.writeFileSync(outputPath, "");
    fs.writeFileSync(path.join(outputDir, "openmontage-direct-render.json"), JSON.stringify({
      mode: "direct-remotion",
      fastMode: runtimeOptions.fastMode,
      provider: runtimeOptions.provider || null,
      model: runtimeOptions.model || null,
      output: outputPath,
      stubbed: true,
    }, null, 2), "utf8");
    return { ok: true, code: 0 };
  }

  const composerDir = path.join(openMontageRoot, "remotion-composer");
  const cliEntry = path.join(composerDir, "node_modules", "@remotion", "cli", "remotion-cli.js");
  const projectEntry = path.join(composerDir, "src", "index.tsx");
  const aspectRatio = String(task.params?.aspectRatio || env.OPENMONTAGE_ASPECT_RATIO || "16:9");
  const dimensions = parseResolution(
    runtimeOptions.resolution || task.params?.resolution || "",
    aspectRatio,
    runtimeOptions.fastMode,
  );
  const props = buildDirectRemotionProps(task, runtimeOptions, dimensions);
  const propsPath = path.join(outputDir, "openmontage-direct-props.json");
  fs.writeFileSync(propsPath, JSON.stringify(props, null, 2), "utf8");

  const preparedEnv = withBundledFfmpegInPath(env);
  const renderer = String(preparedEnv.OPENMONTAGE_DIRECT_REMOTION_RENDERER || preparedEnv.OPENMONTAGE_FAST_RENDERER || "auto").trim().toLowerCase();
  const forceRemotion = renderer === "remotion" || preparedEnv.OPENMONTAGE_FORCE_REMOTION === "1";
  const shouldUseSvg = renderer === "svg" || renderer === "animated-svg";

  if (shouldUseSvg) {
    writeFastAnimatedSvg({ task, taskId, outputDir, runtimeOptions, dimensions, reason: "renderer=svg" });
    return { ok: true, code: 0, renderer: "svg" };
  }

  if (!fs.existsSync(cliEntry) || !fs.existsSync(projectEntry)) {
    writeFastAnimatedSvg({ task, taskId, outputDir, runtimeOptions, dimensions, reason: "Remotion CLI or project entrypoint missing" });
    return { ok: true, code: 0, renderer: "svg" };
  }

  const ffmpegAvailable = await hasCommand("ffmpeg", ["-version"], {
    cwd: composerDir,
    timeoutMs: 2500,
    env: preparedEnv,
  });
  if (!ffmpegAvailable && !forceRemotion) {
    writeFastAnimatedSvg({ task, taskId, outputDir, runtimeOptions, dimensions, reason: "ffmpeg not found on PATH" });
    return { ok: true, code: 0, renderer: "svg" };
  }

  const preflightTimeoutMs = Number(env.OPENMONTAGE_DIRECT_REMOTION_PREFLIGHT_MS || 15_000);
  const preflight = await runWithTimeout(process.execPath, [
    cliEntry,
    "compositions",
    projectEntry,
    "--props", propsPath,
  ], composerDir, {
      env: { ...preparedEnv, CI: "1", NO_COLOR: "1" },
    timeoutMs: preflightTimeoutMs,
    captureStdout: true,
  });
  if ((preflight.timedOut || preflight.exitCode !== 0) && !forceRemotion) {
    writeFastAnimatedSvg({
      task,
      taskId,
      outputDir,
      runtimeOptions,
      dimensions,
      reason: preflight.timedOut
        ? `Remotion preflight timed out after ${preflightTimeoutMs}ms`
        : `Remotion preflight failed with code ${preflight.exitCode}`,
    });
    return { ok: true, code: 0, renderer: "svg" };
  }
  if (preflight.timedOut || preflight.exitCode !== 0) {
    return {
      ok: false,
      code: preflight.exitCode || 1,
      reason: preflight.timedOut
        ? `Direct Remotion preflight timed out after ${preflightTimeoutMs}ms.`
        : `Direct Remotion preflight failed with code ${preflight.exitCode}.`,
    };
  }

  const outputPath = path.join(outputDir, "final.mp4");

  const concurrency = String(Math.max(1, Math.min(runtimeOptions.fastMode ? 2 : 4, os.cpus().length || 2)));
  const args = [
    cliEntry,
    "render",
    projectEntry,
    "Explainer",
    outputPath,
    "--props", propsPath,
    "--codec", "h264",
    "--width", String(dimensions.width),
    "--height", String(dimensions.height),
    "--concurrency", concurrency,
  ];
  if (runtimeOptions.fastMode) {
    args.push("--scale", "0.75");
  }

  const renderTimeoutMs = Number(env.OPENMONTAGE_DIRECT_REMOTION_TIMEOUT_MS || (runtimeOptions.fastMode ? 90_000 : 240_000));
  const render = await runWithTimeout(process.execPath, args, composerDir, {
    env: { ...preparedEnv, CI: "1", NO_COLOR: "1" },
    timeoutMs: renderTimeoutMs,
  });
  if (render.timedOut && !forceRemotion) {
    writeFastAnimatedSvg({
      task,
      taskId,
      outputDir,
      runtimeOptions,
      dimensions,
      reason: `Remotion render timed out after ${renderTimeoutMs}ms`,
    });
    return { ok: true, code: 0, renderer: "svg" };
  }
  if (render.exitCode !== 0 || !fs.existsSync(outputPath)) {
    return {
      ok: false,
      code: render.exitCode || 1,
      reason: render.timedOut
        ? `Direct Remotion rendering timed out after ${renderTimeoutMs}ms.`
        : "Direct Remotion rendering exited without producing final.mp4.",
    };
  }

  fs.writeFileSync(path.join(outputDir, "openmontage-direct-render.json"), JSON.stringify({
    taskId,
    mode: "direct-remotion",
    renderer: "remotion",
    fastMode: runtimeOptions.fastMode,
    provider: runtimeOptions.provider || null,
    model: runtimeOptions.model || null,
    pipeline: runtimeOptions.pipeline || null,
    resolution: `${dimensions.width}x${dimensions.height}`,
    output: outputPath,
  }, null, 2), "utf8");

  return { ok: true, code: 0 };
}

export function buildDirectRemotionProps(task, runtimeOptions = {}, dimensions = { width: 1920, height: 1080 }) {
  const params = task.params || {};
  const prompt = String(task.prompt || "OpenMontage task").trim();
  const durationSeconds = clampDuration(params.duration, runtimeOptions.fastMode);
  const theme = chooseTheme(params.style || "", runtimeOptions.provider || "");
  const assets = collectLocalAssets(params.assetsDir || "", 3);
  const scenes = [];
  let cursor = 0;

  const title = deriveTitle(prompt);
  const subtitle = deriveSubtitle(prompt, params.style || "");
  const introEnd = nextTime(cursor, Math.min(3.2, durationSeconds * 0.28), durationSeconds);
  scenes.push({
    id: `${task.taskId || "task"}-intro`,
    source: "",
    type: "hero_title",
    in_seconds: cursor,
    out_seconds: introEnd,
    text: title,
    subtitle,
    backgroundColor: theme.backgroundColor,
  });
  cursor = introEnd;

  if (assets.length > 0) {
    const segment = Math.max(2.2, Math.min(4.2, (durationSeconds - cursor - 2.4) / assets.length));
    for (const asset of assets) {
      const out = nextTime(cursor, segment, durationSeconds);
      if (asset.kind === "image") {
        scenes.push({
          id: `${task.taskId || "task"}-${path.basename(asset.path, path.extname(asset.path))}`,
          source: asset.path,
          in_seconds: cursor,
          out_seconds: out,
          animation: runtimeOptions.fastMode ? "zoom-in" : "ken-burns",
        });
      } else {
        scenes.push({
          id: `${task.taskId || "task"}-${path.basename(asset.path, path.extname(asset.path))}`,
          source: asset.path,
          in_seconds: cursor,
          out_seconds: out,
          source_in_seconds: 0,
        });
      }
      cursor = out;
      if (cursor >= durationSeconds - 2.4) break;
    }
  }

  const textBlocks = splitPrompt(prompt, 2);
  for (const block of textBlocks) {
    if (cursor >= durationSeconds - 2.4) break;
    const out = nextTime(cursor, 2.6, durationSeconds);
    scenes.push({
      id: `${task.taskId || "task"}-text-${scenes.length + 1}`,
      source: "",
      type: "text_card",
      in_seconds: cursor,
      out_seconds: out,
      text: block,
      subtitle: buildMetadataLine(params, runtimeOptions, dimensions),
      color: theme.textColor,
      backgroundColor: theme.backgroundColor,
    });
    cursor = out;
  }

  if (cursor < durationSeconds - 1.6) {
    const out = durationSeconds;
    scenes.push({
      id: `${task.taskId || "task"}-close`,
      source: "",
      type: "callout",
      in_seconds: cursor,
      out_seconds: out,
      title: runtimeOptions.provider ? `Provider: ${runtimeOptions.provider}` : "OpenMontage",
      text: runtimeOptions.model
        ? `Model: ${runtimeOptions.model}`
        : runtimeOptions.pipeline
          ? `Pipeline: ${runtimeOptions.pipeline}`
          : "Direct Remotion render path",
      callout_type: "tip",
      accentColor: theme.accentColor,
      backgroundColor: theme.backgroundColor,
    });
  }

  const overlays = [];
  if (runtimeOptions.pipeline) {
    overlays.push({
      type: "section_title",
      in_seconds: 0.4,
      out_seconds: Math.min(durationSeconds, 3.6),
      text: runtimeOptions.pipeline,
      subtitle: runtimeOptions.fastMode ? "Fast local render" : "Direct local render",
      accentColor: theme.accentColor,
    });
  }
  if (runtimeOptions.provider) {
    overlays.push({
      type: "provider_chip",
      in_seconds: Math.max(0.8, durationSeconds - 4),
      out_seconds: durationSeconds,
      providers: [runtimeOptions.provider, runtimeOptions.model || "default"].filter(Boolean),
      cycleSeconds: 1.6,
      label: "Provider",
      accentColor: theme.accentColor,
      position: "bottom-right",
    });
  }

  return {
    theme: theme.name,
    cuts: scenes,
    overlays,
    captions: [],
    audio: {},
    metadata: {
      prompt,
      resolution: `${dimensions.width}x${dimensions.height}`,
      aspectRatio: params.aspectRatio || "16:9",
    },
  };
}

export async function renderOpenMontageDemo(openMontageRoot, demoName, targetDir, env = process.env) {
  const renderDemo = path.join(openMontageRoot, "render_demo.py");
  if (!fs.existsSync(renderDemo)) return false;
  const before = listFiles(path.join(openMontageRoot, "projects", "demos", "renders"));
  const code = await run(resolvePython(env), [renderDemo, demoName], openMontageRoot, {
    env: withBundledFfmpegInPath(env),
  });
  if (code !== 0) return false;
  const rendersDir = path.join(openMontageRoot, "projects", "demos", "renders");
  const expected = path.join(rendersDir, `${demoName}.mp4`);
  const after = listFiles(rendersDir);
  const produced = fs.existsSync(expected)
    ? expected
    : after.find((file) => !before.has(file) && path.extname(file).toLowerCase() === ".mp4");
  if (!produced || !fs.existsSync(produced)) return false;

  const target = path.join(targetDir, `openmontage-${demoName}.mp4`);
  fs.copyFileSync(produced, target);
  fs.writeFileSync(path.join(targetDir, "openmontage-demo-render.json"), JSON.stringify({
    mode: "demo-render",
    openMontageRoot,
    demoName,
    source: produced,
    output: target,
  }, null, 2), "utf8");
  return true;
}

export function findOpenMontageRoot(preferred) {
  const candidates = [
    findBundledOpenMontageRoot(preferred),
    process.env.OPENMONTAGE_SOURCE_ROOT,
    preferred,
    path.resolve(process.cwd()),
    path.resolve(process.cwd(), "OpenMontage-main"),
    path.resolve(process.cwd(), "..", "OpenMontage-main"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(path.join(candidate, "AGENT_GUIDE.md")) && fs.existsSync(path.join(candidate, "render_demo.py"))) {
        return candidate;
      }
    } catch {
      // Ignore invalid candidate paths.
    }
  }
  return "";
}

export function resolvePython(env = process.env) {
  const bundled = getBundledPythonExecutable();
  if (bundled) return bundled;
  return process.platform === "win32" ? "python.exe" : "python3";
}

export function listFiles(dirPath) {
  const files = new Set();
  if (!fs.existsSync(dirPath)) return files;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isFile()) files.add(path.join(dirPath, entry.name));
  }
  return files;
}

export function hasOutputMedia(dir) {
  const mediaExts = new Set([".mp4", ".mov", ".webm", ".mkv", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
  const stack = [dir];
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

export function hasExecutorFailureArtifacts(outputDir) {
  for (const file of [
    "OPENMONTAGE_FAILURE.md",
    "OPENMONTAGE_RESULT.json",
    "OPENMONTAGE_AGENT_SUMMARY.txt",
  ]) {
    if (fs.existsSync(path.join(outputDir, file))) return true;
  }
  return false;
}

export function buildPreviewSvg(task) {
  const prompt = escapeXml(task.prompt || "OpenMontage task");
  const params = task.params || {};
  const duration = escapeXml(params.duration || "unspecified");
  const ratio = escapeXml(params.aspectRatio || "16:9");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#111827"/>
      <stop offset="55%" stop-color="#243b53"/>
      <stop offset="100%" stop-color="#0f766e"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <rect x="72" y="72" width="1136" height="576" rx="34" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
  <text x="112" y="145" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="42" font-weight="700">OpenMontage Task Package</text>
  <text x="112" y="215" fill="#d1fae5" font-family="Segoe UI, Arial, sans-serif" font-size="24">Runtime not configured. This preview confirms the Hanako bridge is working.</text>
  <foreignObject x="112" y="260" width="1056" height="210">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font: 30px/1.35 'Segoe UI', Arial, sans-serif; color: #fff; word-break: break-word;">
      ${prompt}
    </div>
  </foreignObject>
  <text x="112" y="540" fill="#e5e7eb" font-family="Segoe UI, Arial, sans-serif" font-size="24">Duration: ${duration}</text>
  <text x="112" y="584" fill="#e5e7eb" font-family="Segoe UI, Arial, sans-serif" font-size="24">Aspect ratio: ${ratio}</text>
</svg>`;
}

export function writeFastAnimatedSvg({ task, taskId, outputDir, runtimeOptions = {}, dimensions, reason = "" }) {
  const outputPath = path.join(outputDir, "final.svg");
  fs.writeFileSync(outputPath, buildFastAnimatedSvg(task, runtimeOptions, dimensions), "utf8");
  fs.writeFileSync(path.join(outputDir, "openmontage-direct-render.json"), JSON.stringify({
    taskId,
    mode: "direct-remotion",
    renderer: "animated-svg",
    fastMode: runtimeOptions.fastMode,
    provider: runtimeOptions.provider || null,
    model: runtimeOptions.model || null,
    pipeline: runtimeOptions.pipeline || null,
    resolution: `${dimensions.width}x${dimensions.height}`,
    output: outputPath,
    fallbackReason: reason || null,
  }, null, 2), "utf8");
}

export function buildFastAnimatedSvg(task, runtimeOptions = {}, dimensions = { width: 1280, height: 720 }) {
  const params = task.params || {};
  const prompt = String(task.prompt || "OpenMontage task").trim();
  const theme = chooseTheme(params.style || "", runtimeOptions.provider || "");
  const title = deriveTitle(prompt);
  const lines = wrapSvgLines(prompt, containsCjk(prompt) ? 18 : 34, 3);
  const accent = theme.accentColor;
  const bg = theme.backgroundColor;
  const fg = theme.textColor;
  const width = dimensions.width || 1280;
  const height = dimensions.height || 720;
  const titleY = Math.round(height * 0.32);
  const bodyY = Math.round(height * 0.46);
  const meta = [
    runtimeOptions.pipeline || "direct-remotion",
    runtimeOptions.provider || "",
    runtimeOptions.model || "",
    params.aspectRatio || "",
  ].filter(Boolean).join(" | ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="om-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${escapeXml(bg)}"/>
      <stop offset="52%" stop-color="${escapeXml(shiftHex(bg, theme.name === "clean-professional" || theme.name === "minimalist-diagram" ? -0.08 : 0.12))}"/>
      <stop offset="100%" stop-color="${escapeXml(accent)}"/>
    </linearGradient>
    <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000" flood-opacity="0.22"/>
    </filter>
    <style>
      @keyframes om-fade-up { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes om-drift-a { from { transform: translate(-4%, -3%) scale(1); } to { transform: translate(3%, 2%) scale(1.08); } }
      @keyframes om-drift-b { from { transform: translate(5%, 4%) scale(1); } to { transform: translate(-3%, -2%) scale(1.12); } }
      @keyframes om-line { from { stroke-dashoffset: 1000; } to { stroke-dashoffset: 0; } }
      .orb-a { animation: om-drift-a 7s ease-in-out infinite alternate; transform-origin: center; }
      .orb-b { animation: om-drift-b 8s ease-in-out infinite alternate; transform-origin: center; }
      .card { animation: om-fade-up 700ms ease-out both; }
      .title { animation: om-fade-up 850ms ease-out 120ms both; }
      .body { animation: om-fade-up 850ms ease-out 260ms both; }
      .meta { animation: om-fade-up 850ms ease-out 420ms both; }
      .line { stroke-dasharray: 1000; animation: om-line 3.5s ease-in-out infinite alternate; }
    </style>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#om-bg)"/>
  <circle class="orb-a" cx="${Math.round(width * 0.18)}" cy="${Math.round(height * 0.26)}" r="${Math.round(width * 0.18)}" fill="${escapeXml(accent)}" opacity="0.16"/>
  <circle class="orb-b" cx="${Math.round(width * 0.82)}" cy="${Math.round(height * 0.72)}" r="${Math.round(width * 0.22)}" fill="#ffffff" opacity="0.10"/>
  <path class="line" d="M ${Math.round(width * 0.09)} ${Math.round(height * 0.78)} C ${Math.round(width * 0.32)} ${Math.round(height * 0.58)}, ${Math.round(width * 0.62)} ${Math.round(height * 0.92)}, ${Math.round(width * 0.91)} ${Math.round(height * 0.62)}" fill="none" stroke="${escapeXml(fg)}" stroke-opacity="0.22" stroke-width="3"/>
  <rect class="card" x="${Math.round(width * 0.075)}" y="${Math.round(height * 0.14)}" width="${Math.round(width * 0.85)}" height="${Math.round(height * 0.72)}" rx="34" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.28)" filter="url(#soft-shadow)"/>
  <text class="title" x="${Math.round(width * 0.12)}" y="${titleY}" fill="${escapeXml(fg)}" font-family="Segoe UI, Arial, sans-serif" font-size="${Math.max(32, Math.round(width * 0.048))}" font-weight="800">${escapeXml(title)}</text>
  <g class="body" fill="${escapeXml(fg)}" font-family="Segoe UI, Arial, sans-serif" font-size="${Math.max(22, Math.round(width * 0.026))}" opacity="0.92">
${lines.map((line, index) => `    <text x="${Math.round(width * 0.12)}" y="${bodyY + index * Math.max(34, Math.round(width * 0.038))}">${escapeXml(line)}</text>`).join("\n")}
  </g>
  <text class="meta" x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.75)}" fill="${escapeXml(fg)}" font-family="Segoe UI, Arial, sans-serif" font-size="${Math.max(16, Math.round(width * 0.017))}" opacity="0.72">${escapeXml(meta || "Fast animated SVG render")}</text>
</svg>`;
}

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shouldAttemptDirectRemotion(runtimeOptions, env) {
  if (env.OPENMONTAGE_DISABLE_DIRECT_REMOTION === "1") return false;
  return runtimeOptions.mode === "direct-remotion" || (runtimeOptions.mode === "auto" && runtimeOptions.fastMode);
}

function writeFailure(outputDir, reason) {
  const failurePath = path.join(outputDir, "OPENMONTAGE_FAILURE.md");
  if (fs.existsSync(failurePath)) return;
  fs.writeFileSync(failurePath, [
    "# OpenMontage Failure",
    "",
    reason,
    "",
  ].join("\n"), "utf8");
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

async function hasCommand(command, args, { cwd, timeoutMs, env = process.env }) {
  const result = await runWithTimeout(command, args, cwd, {
    timeoutMs,
    captureStdout: true,
    env,
  });
  return result.exitCode === 0;
}

function clampDuration(duration, fastMode) {
  const parsed = Number(duration);
  if (!Number.isFinite(parsed) || parsed <= 0) return fastMode ? 10 : 16;
  return Math.max(6, Math.min(parsed, 90));
}

function chooseTheme(style, provider) {
  const normalized = `${style} ${provider}`.toLowerCase();
  if (normalized.includes("anime") || normalized.includes("ghibli")) return DIRECT_THEMES["anime-ghibli"];
  if (normalized.includes("minimal") || normalized.includes("clean") || normalized.includes("professional")) {
    return DIRECT_THEMES["clean-professional"];
  }
  if (normalized.includes("diagram") || normalized.includes("technical")) return DIRECT_THEMES["minimalist-diagram"];
  return DIRECT_THEMES["flat-motion-graphics"];
}

function collectLocalAssets(assetsDir, limit) {
  const resolved = String(assetsDir || "").trim();
  if (!resolved || !fs.existsSync(resolved)) return [];
  const stack = [resolved];
  const files = [];
  while (stack.length && files.length < limit) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) {
        files.push({ kind: "image", path: full });
      } else if ([".mp4", ".mov", ".webm", ".mkv"].includes(ext)) {
        files.push({ kind: "video", path: full });
      }
      if (files.length >= limit) break;
    }
  }
  return files;
}

function deriveTitle(prompt) {
  const cleaned = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "OpenMontage";
  if (containsCjk(cleaned)) return cleaned.slice(0, 18);
  const words = cleaned.split(" ").slice(0, 6);
  return words.join(" ");
}

function deriveSubtitle(prompt, style) {
  const parts = splitPrompt(prompt, 2);
  if (parts.length > 1) return parts[1];
  if (style) return style;
  return "Fast local composition path";
}

function splitPrompt(prompt, limit) {
  const segments = String(prompt || "")
    .split(/[\r\n]+|(?<=[.!?。！？；;])/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (segments.length === 0) return ["OpenMontage video request"];
  return segments.slice(0, limit).map((segment) => segment.length > 120 ? `${segment.slice(0, 117)}...` : segment);
}

function buildMetadataLine(params, runtimeOptions, dimensions) {
  const pieces = [];
  if (params.aspectRatio) pieces.push(params.aspectRatio);
  pieces.push(`${dimensions.width}x${dimensions.height}`);
  if (runtimeOptions.provider) pieces.push(runtimeOptions.provider);
  if (runtimeOptions.model) pieces.push(runtimeOptions.model);
  return pieces.join(" | ");
}

function nextTime(start, seconds, totalDuration) {
  return Number(Math.min(totalDuration, (start + seconds)).toFixed(2));
}

function containsCjk(value) {
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(value);
}

function wrapSvgLines(text, maxChars, maxLines) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return ["OpenMontage video request"];
  if (containsCjk(clean)) {
    const lines = [];
    for (let i = 0; i < clean.length && lines.length < maxLines; i += maxChars) {
      lines.push(clean.slice(i, i + maxChars));
    }
    return lines;
  }
  const words = clean.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.map((line, index) => (
    index === maxLines - 1 && words.join(" ").length > lines.join(" ").length
      ? `${line.replace(/\.*$/, "")}...`
      : line
  ));
}

function shiftHex(hex, amount) {
  const clean = String(hex || "#111827").replace("#", "");
  const normalized = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = Number.parseInt(normalized, 16);
  if (!Number.isFinite(num)) return hex;
  const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const next = [r, g, b].map((channel) => (
    amount < 0
      ? clamp(channel * (1 + amount))
      : clamp(channel + (255 - channel) * amount)
  ));
  return `#${next.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
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
