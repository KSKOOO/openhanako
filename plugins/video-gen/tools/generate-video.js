import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const name = "generate-video";
export const description = "使用AI生成视频。支持文本到视频、图片到视频等多种模式。";
export const promptSnippet = "当用户要生成视频、制作动画、创建视频内容时，调用 video-gen_generate-video。";

export const parameters = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      description: "视频生成提示词，描述想要生成的视频内容、场景、动作等。",
    },
    imageUrl: {
      type: "string",
      description: "可选。起始图片URL，用于图片到视频模式。",
    },
    duration: {
      type: "number",
      description: "视频时长（秒），默认使用配置中的默认值。",
      minimum: 1,
      maximum: 30,
    },
    resolution: {
      type: "string",
      enum: ["720p", "1080p", "4k"],
      description: "视频分辨率，默认使用配置中的默认值。",
    },
    fps: {
      type: "number",
      description: "帧率，默认24fps。",
      minimum: 12,
      maximum: 60,
    },
    style: {
      type: "string",
      description: "视频风格，如：realistic（真实）、anime（动漫）、cinematic（电影感）等。",
    },
    negativePrompt: {
      type: "string",
      description: "负面提示词，描述不想在视频中出现的内容。",
    },
  },
  required: ["prompt"],
};

function makeTaskId() {
  return `video-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

function getResolutionDimensions(resolution) {
  const resolutions = {
    "720p": { width: 1280, height: 720 },
    "1080p": { width: 1920, height: 1080 },
    "4k": { width: 3840, height: 2160 },
  };
  return resolutions[resolution] || resolutions["1080p"];
}

export async function execute(input, ctx) {
  const { config, dataDir, log } = ctx;

  // 获取配置
  const provider = config.get("provider") || "runway";
  const defaultDuration = config.get("defaultDuration") || 5;
  const defaultResolution = config.get("defaultResolution") || "1080p";
  const maxConcurrent = config.get("maxConcurrent") || 2;

  // 验证输入
  const prompt = String(input?.prompt || "").trim();
  if (!prompt) {
    return {
      content: [{ type: "text", text: "请提供视频生成提示词。" }],
    };
  }

  // 准备任务参数
  const taskId = makeTaskId();
  const duration = input?.duration || defaultDuration;
  const resolution = input?.resolution || defaultResolution;
  const fps = input?.fps || 24;
  const dimensions = getResolutionDimensions(resolution);

  const taskParams = {
    taskId,
    prompt,
    imageUrl: input?.imageUrl || null,
    duration,
    resolution,
    fps,
    dimensions,
    style: input?.style || "realistic",
    negativePrompt: input?.negativePrompt || "",
    provider,
    createdAt: new Date().toISOString(),
  };

  // 保存任务信息
  const tasksDir = path.join(dataDir, "tasks");
  await fs.mkdir(tasksDir, { recursive: true });
  const taskFile = path.join(tasksDir, `${taskId}.json`);
  await fs.writeFile(taskFile, JSON.stringify(taskParams, null, 2));

  log.info(`Video generation task created: ${taskId}`);

  // 根据provider调用相应的生成函数
  try {
    let result;
    switch (provider) {
      case "runway":
        result = await generateWithRunway(taskParams, config, log);
        break;
      case "pika":
        result = await generateWithPika(taskParams, config, log);
        break;
      case "kling":
        result = await generateWithKling(taskParams, config, log);
        break;
      case "comfyui":
        result = await generateWithComfyUI(taskParams, config, log);
        break;
      case "custom":
        result = await generateWithCustomAPI(taskParams, config, log);
        break;
      default:
        throw new Error(`不支持的视频生成服务: ${provider}`);
    }

    // 更新任务状态
    taskParams.status = "completed";
    taskParams.result = result;
    taskParams.completedAt = new Date().toISOString();
    await fs.writeFile(taskFile, JSON.stringify(taskParams, null, 2));

    return {
      content: [
        {
          type: "text",
          text: `视频生成完成！\n提示词: ${prompt}\n时长: ${duration}秒\n分辨率: ${resolution}`,
        },
      ],
      details: {
        media: {
          mediaUrls: [result.videoPath],
        },
        videoGeneration: {
          taskId,
          status: "completed",
          videoUrl: result.videoUrl,
          thumbnailUrl: result.thumbnailUrl,
        },
      },
    };
  } catch (error) {
    log.error(`Video generation failed: ${error.message}`);

    // 更新任务状态为失败
    taskParams.status = "failed";
    taskParams.error = error.message;
    taskParams.failedAt = new Date().toISOString();
    await fs.writeFile(taskFile, JSON.stringify(taskParams, null, 2));

    return {
      content: [
        {
          type: "text",
          text: `视频生成失败: ${error.message}\n\n请检查API配置和网络连接。`,
        },
      ],
    };
  }
}

// Runway ML API
async function generateWithRunway(params, config, log) {
  const apiKey = config.get("runwayApiKey");
  if (!apiKey) {
    throw new Error("未配置 Runway API Key");
  }

  log.info("Generating video with Runway ML...");

  // 这里是示例实现，实际需要根据Runway API文档调整
  const response = await fetch("https://api.runwayml.com/v1/generate", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: params.prompt,
      duration: params.duration,
      resolution: params.resolution,
      image_url: params.imageUrl,
    }),
  });

  if (!response.ok) {
    throw new Error(`Runway API error: ${response.statusText}`);
  }

  const data = await response.json();

  return {
    videoPath: data.video_url,
    videoUrl: data.video_url,
    thumbnailUrl: data.thumbnail_url,
  };
}

// Pika Labs API
async function generateWithPika(params, config, log) {
  const apiKey = config.get("pikaApiKey");
  if (!apiKey) {
    throw new Error("未配置 Pika API Key");
  }

  log.info("Generating video with Pika Labs...");

  // 示例实现
  throw new Error("Pika Labs API 集成开发中");
}

// 可灵AI API
async function generateWithKling(params, config, log) {
  const apiKey = config.get("klingApiKey");
  if (!apiKey) {
    throw new Error("未配置 Kling API Key");
  }

  log.info("Generating video with Kling AI...");

  // 示例实现
  throw new Error("Kling AI API 集成开发中");
}

// ComfyUI API
async function generateWithComfyUI(params, config, log) {
  const comfyuiUrl = config.get("comfyuiUrl") || "http://127.0.0.1:8188";

  log.info("Generating video with ComfyUI...");

  // 检查ComfyUI是否可用
  try {
    const healthCheck = await fetch(`${comfyuiUrl}/system_stats`);
    if (!healthCheck.ok) {
      throw new Error("ComfyUI 服务不可用");
    }
  } catch (error) {
    throw new Error(`无法连接到 ComfyUI: ${error.message}`);
  }

  // 构建ComfyUI工作流
  const workflow = {
    "3": {
      "inputs": {
        "text": params.prompt,
        "clip": ["4", 1]
      },
      "class_type": "CLIPTextEncode"
    },
    "4": {
      "inputs": {
        "ckpt_name": "sd_xl_base_1.0.safetensors"
      },
      "class_type": "CheckpointLoaderSimple"
    },
    // 添加更多节点以支持视频生成
  };

  const response = await fetch(`${comfyuiUrl}/prompt`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt: workflow }),
  });

  if (!response.ok) {
    throw new Error(`ComfyUI API error: ${response.statusText}`);
  }

  const data = await response.json();

  // 轮询任务状态
  const promptId = data.prompt_id;
  let completed = false;
  let attempts = 0;
  const maxAttempts = 60; // 最多等待5分钟

  while (!completed && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // 等待5秒

    const historyResponse = await fetch(`${comfyuiUrl}/history/${promptId}`);
    const history = await historyResponse.json();

    if (history[promptId]?.status?.completed) {
      completed = true;
      const outputs = history[promptId].outputs;
      // 从outputs中提取视频路径
      // 这需要根据实际的ComfyUI工作流调整
    }

    attempts++;
  }

  if (!completed) {
    throw new Error("ComfyUI 视频生成超时");
  }

  return {
    videoPath: `/comfyui/output/${promptId}.mp4`,
    videoUrl: `${comfyuiUrl}/view?filename=${promptId}.mp4`,
    thumbnailUrl: null,
  };
}

// 自定义API
async function generateWithCustomAPI(params, config, log) {
  const apiUrl = config.get("customApiUrl");
  const apiKey = config.get("customApiKey");

  if (!apiUrl) {
    throw new Error("未配置自定义 API URL");
  }

  log.info("Generating video with custom API...");

  const headers = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt: params.prompt,
      duration: params.duration,
      resolution: params.resolution,
      image_url: params.imageUrl,
      fps: params.fps,
      style: params.style,
      negative_prompt: params.negativePrompt,
    }),
  });

  if (!response.ok) {
    throw new Error(`Custom API error: ${response.statusText}`);
  }

  const data = await response.json();

  return {
    videoPath: data.video_url || data.videoUrl || data.url,
    videoUrl: data.video_url || data.videoUrl || data.url,
    thumbnailUrl: data.thumbnail_url || data.thumbnailUrl || null,
  };
}
