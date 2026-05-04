import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runWithTimeout, findOpenMontageRoot } from "../bin/openmontage-wrapper.mjs";
import {
  findBundledOpenMontageRoot,
  getBundledFfmpegExecutable,
  getBundledPythonExecutable,
  withBundledFfmpegInPath,
} from "../lib/runtime-deps.js";
import { routeError, strictJson } from "../../../server/hono-helpers.js";

const CONFIG_KEYS = new Set([
  "runtimeCommand",
  "runtimeArgsTemplate",
  "agentCommand",
  "agentArgsTemplate",
  "openMontageRoot",
  "demoName",
  "agentBackend",
  "mode",
  "fastMode",
  "pipeline",
  "videoProvider",
  "videoModel",
  "videoApiKey",
  "videoBaseUrl",
  "videoResolution",
  "providerEnvOverridesJson",
  "directRemotionRenderer",
  "directRemotionTimeoutMs",
  "directRemotionPreflightMs",
  "runtimeTimeoutMs",
]);

export default function (app, ctx) {
  app.get("/config", (c) => c.json(readPublicConfig(ctx)));

  app.put("/config", async (c) => {
    let body;
    try {
      body = await strictJson(c);
    } catch (err) {
      return routeError(c, err);
    }
    for (const [key, value] of Object.entries(body || {})) {
      if (!CONFIG_KEYS.has(key)) continue;
      if (key === "videoApiKey" && value === "") continue;
      ctx.config.set(key, normalizeConfigValue(key, value));
    }
    if (body?.clearVideoApiKey === true) {
      ctx.config.set("videoApiKey", undefined);
    }
    return c.json(readPublicConfig(ctx));
  });

  app.get("/diagnostics", async (c) => {
    const deep = c.req.query("deep") === "1";
    return c.json(await buildDiagnostics(ctx, { deep }));
  });

  app.post("/provider-test", async (c) => {
    let body;
    try {
      body = await strictJson(c);
    } catch (err) {
      return routeError(c, err);
    }
    return c.json(await runProviderConnectivityTest(ctx, body));
  });

  app.post("/test-render", async (c) => {
    let body;
    try {
      body = await strictJson(c);
    } catch (err) {
      return routeError(c, err);
    }
    const started = Date.now();
    const taskId = `openmontage-test-${Date.now().toString(36)}`;
    const workDir = path.join(ctx.dataDir, "diagnostics", taskId);
    const outDir = path.join(workDir, "out");
    const taskFile = path.join(workDir, "task.json");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(taskFile, JSON.stringify({
      taskId,
      prompt: String(body.prompt || "OpenMontage integrated fast render test"),
      params: {
        duration: 8,
        aspectRatio: "16:9",
        resolution: body.resolution || ctx.config.get("videoResolution") || "1280x720",
        mode: "direct-remotion",
        fastMode: true,
        pipeline: body.pipeline || ctx.config.get("pipeline") || "animated-explainer",
      },
    }, null, 2), "utf8");

    const wrapper = path.join(ctx.pluginDir, "bin", "openmontage-wrapper.mjs");
    const env = {
      ...withBundledFfmpegInPath(process.env),
      OPENMONTAGE_ROOT: String(ctx.config.get("openMontageRoot") || process.env.OPENMONTAGE_ROOT || ""),
      OPENMONTAGE_DIRECT_REMOTION_RENDERER: String(ctx.config.get("directRemotionRenderer") || process.env.OPENMONTAGE_DIRECT_REMOTION_RENDERER || "auto"),
      OPENMONTAGE_DIRECT_REMOTION_TIMEOUT_MS: String(ctx.config.get("directRemotionTimeoutMs") || process.env.OPENMONTAGE_DIRECT_REMOTION_TIMEOUT_MS || ""),
      OPENMONTAGE_DIRECT_REMOTION_PREFLIGHT_MS: String(ctx.config.get("directRemotionPreflightMs") || process.env.OPENMONTAGE_DIRECT_REMOTION_PREFLIGHT_MS || ""),
      OPENMONTAGE_VIDEO_PROVIDER: String(ctx.config.get("videoProvider") || ""),
      OPENMONTAGE_VIDEO_MODEL: String(ctx.config.get("videoModel") || ""),
      OPENMONTAGE_VIDEO_BASE_URL: String(ctx.config.get("videoBaseUrl") || ""),
      OPENMONTAGE_VIDEO_RESOLUTION: String(ctx.config.get("videoResolution") || ""),
      OPENMONTAGE_VIDEO_API_KEY: String(ctx.config.get("videoApiKey") || ""),
      OPENMONTAGE_PROVIDER_ENV_OVERRIDES: String(ctx.config.get("providerEnvOverridesJson") || ""),
    };

    const result = await runWithTimeout(process.execPath, [
      wrapper,
      "--task-file", taskFile,
      "--output-dir", outDir,
      "--task-id", taskId,
    ], ctx.pluginDir, {
      env,
      timeoutMs: Number(ctx.config.get("runtimeTimeoutMs") || 120_000),
      captureStdout: true,
    });

    const files = listFiles(outDir);
    const metadataPath = path.join(outDir, "openmontage-direct-render.json");
    const metadata = readJson(metadataPath) || null;
    return c.json({
      ok: result.exitCode === 0 && files.length > 0,
      exitCode: result.exitCode,
      timedOut: !!result.timedOut,
      elapsedMs: Date.now() - started,
      files: files.map((file) => ({
        name: path.basename(file),
        size: fs.statSync(file).size,
      })),
      metadata,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      outputDir: outDir,
    });
  });
}

function readPublicConfig(ctx) {
  const data = ctx.config.get() || {};
  const copy = {};
  for (const key of CONFIG_KEYS) {
    if (key === "videoApiKey") continue;
    if (data[key] !== undefined) copy[key] = data[key];
  }
  copy.hasVideoApiKey = !!data.videoApiKey;
  copy.detectedOpenMontageRoot = findOpenMontageRoot(data.openMontageRoot || process.env.OPENMONTAGE_ROOT || "");
  copy.bundledOpenMontageRoot = findBundledOpenMontageRoot(data.openMontageRoot || process.env.OPENMONTAGE_ROOT || "");
  copy.bundledFfmpeg = getBundledFfmpegExecutable();
  copy.bundledPython = getBundledPythonExecutable();
  return copy;
}

async function buildDiagnostics(ctx, { deep = false } = {}) {
  const config = ctx.config.get() || {};
  const root = findOpenMontageRoot(config.openMontageRoot || process.env.OPENMONTAGE_ROOT || "");
  const composerDir = root ? path.join(root, "remotion-composer") : "";
  const remotionCli = composerDir ? path.join(composerDir, "node_modules", "@remotion", "cli", "remotion-cli.js") : "";
  const checks = {
    openMontageRoot: {
      ok: !!root,
      value: root || "",
      message: root ? "OpenMontage repository found" : "OpenMontage repository not found",
    },
    node: {
      ok: true,
      value: process.execPath,
      message: `Node ${process.version}`,
    },
    remotionCli: {
      ok: !!(remotionCli && fs.existsSync(remotionCli)),
      value: remotionCli || "",
      message: remotionCli && fs.existsSync(remotionCli) ? "Remotion CLI installed" : "Remotion CLI missing",
    },
    remotionNodeModules: {
      ok: !!(composerDir && fs.existsSync(path.join(composerDir, "node_modules"))),
      value: composerDir ? path.join(composerDir, "node_modules") : "",
      message: composerDir && fs.existsSync(path.join(composerDir, "node_modules")) ? "Remotion dependencies installed" : "Remotion dependencies missing",
    },
    ffmpeg: await checkCommand("ffmpeg", ["-version"], 2500),
    bundledFfmpeg: {
      ok: !!getBundledFfmpegExecutable(),
      value: getBundledFfmpegExecutable(),
      message: getBundledFfmpegExecutable() ? "Bundled ffmpeg found" : "Bundled ffmpeg missing",
    },
    bundledPython: {
      ok: !!getBundledPythonExecutable(),
      value: getBundledPythonExecutable(),
      message: getBundledPythonExecutable() ? "Bundled python found" : "Bundled python missing",
    },
  };

  if (deep && checks.remotionCli.ok) {
    const preflight = await runWithTimeout(process.execPath, [
      remotionCli,
      "compositions",
      path.join(composerDir, "src", "index.tsx"),
    ], composerDir, {
      timeoutMs: Number(config.directRemotionPreflightMs || 5000),
      captureStdout: true,
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
    });
    checks.remotionPreflight = {
      ok: preflight.exitCode === 0,
      value: preflight.timedOut ? "timeout" : String(preflight.exitCode),
      message: preflight.timedOut
        ? "Remotion preflight timed out; fast SVG fallback will be used"
        : preflight.exitCode === 0
          ? "Remotion preflight passed"
          : "Remotion preflight failed",
    };
  }

  const renderer = String(config.directRemotionRenderer || "auto");
  const clickReady = renderer === "svg" || renderer === "animated-svg" || checks.ffmpeg.ok || renderer === "auto";
  return {
    ok: checks.openMontageRoot.ok,
    clickReady,
    renderer,
    recommendedRenderer: checks.ffmpeg.ok ? "auto" : "svg",
    checks,
    platform: {
      os: os.platform(),
      arch: os.arch(),
    },
  };
}

async function checkCommand(command, args, timeoutMs) {
  const result = await runWithTimeout(command, args, process.cwd(), {
    timeoutMs,
    captureStdout: true,
    env: withBundledFfmpegInPath(process.env),
  });
  return {
    ok: result.exitCode === 0,
    value: result.exitCode === 0 ? command : "",
    message: result.exitCode === 0
      ? `${command} is available`
      : result.timedOut
        ? `${command} check timed out`
        : `${command} not found`,
  };
}

function normalizeConfigValue(key, value) {
  if (value === undefined) return undefined;
  if (key.endsWith("Ms") || key === "runtimeTimeoutMs") {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  if (key === "fastMode") return value === true || value === "true" || value === "1";
  return String(value || "").trim();
}

async function runProviderConnectivityTest(ctx, body = {}) {
  const current = ctx.config.get() || {};
  const provider = String(body.videoProvider || current.videoProvider || "").trim();
  const baseUrl = String(body.videoBaseUrl || current.videoBaseUrl || "").trim().replace(/\/+$/, "");
  const apiKey = String(body.videoApiKey || current.videoApiKey || "").trim();

  if (!provider) {
    return {
      ok: false,
      reachable: false,
      message: "Please fill in the video provider first.",
      suggestion: "Fill in the video provider field before running the connectivity test.",
    };
  }

  if (provider.toLowerCase() === "local") {
    return {
      ok: true,
      reachable: true,
      skipped: true,
      message: "Local provider does not require a remote connectivity test.",
    };
  }

  if (!baseUrl) {
    return {
      ok: false,
      reachable: false,
      message: "Provider API base URL is missing.",
      suggestion: "Fill in the provider API base URL / endpoint field first.",
    };
  }

  const candidates = buildProviderTestCandidates(baseUrl);
  let lastError = null;
  let reachableResponse = null;

  for (const endpoint of candidates) {
    try {
      const res = await fetch(endpoint, {
        method: "GET",
        headers: buildProviderTestHeaders(apiKey),
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        return {
          ok: true,
          reachable: true,
          status: res.status,
          endpoint,
          message: "Provider connectivity check passed.",
        };
      }

      reachableResponse = { endpoint, status: res.status };

      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          reachable: true,
          status: res.status,
          endpoint,
          message: "Endpoint is reachable, but the provider rejected the API key.",
          suggestion: "Check the provider API key, project permissions, and account scope.",
        };
      }

      if (res.status === 404) {
        continue;
      }

      return {
        ok: false,
        reachable: true,
        status: res.status,
        endpoint,
        message: `Endpoint responded with HTTP ${res.status}.`,
        suggestion: "Check whether the base URL / endpoint path matches the target provider.",
      };
    } catch (err) {
      lastError = err;
    }
  }

  if (reachableResponse) {
    return {
      ok: false,
      reachable: true,
      status: reachableResponse.status,
      endpoint: reachableResponse.endpoint,
      message: `Endpoint responded with HTTP ${reachableResponse.status}.`,
      suggestion: "Check whether the provider base URL points to a valid API entry point.",
    };
  }

  return {
    ok: false,
    reachable: false,
    endpoint: candidates[0] || baseUrl,
    message: lastError?.message || "Provider connectivity request failed.",
    suggestion: "Check network connectivity, proxy/VPN, firewall, and the provider endpoint availability.",
  };
}

function buildProviderTestCandidates(baseUrl) {
  const candidates = [
    `${baseUrl}/models`,
    `${baseUrl}/v1/models`,
    baseUrl,
  ];
  return [...new Set(candidates)];
}

function buildProviderTestHeaders(apiKey) {
  const headers = {
    accept: "application/json",
  };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function listFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const result = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isFile()) result.push(full);
  }
  return result;
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
