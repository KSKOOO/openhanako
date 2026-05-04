# 视频生成插件 (Video Generation Plugin)

AI驱动的视频生成插件，支持多种在线API和本地ComfyUI服务。

## 功能特性

- 🎬 **多种生成模式**：文本到视频、图片到视频
- 🔌 **多服务支持**：Runway ML、Pika Labs、可灵AI、ComfyUI、自定义API
- ⚙️ **灵活配置**：分辨率、时长、帧率、风格等参数可调
- 📊 **任务管理**：查看历史任务、管理生成队列
- 🎨 **风格控制**：支持真实、动漫、电影感等多种风格

## 安装

1. 将 `video-gen` 文件夹拖入 Hanako 设置 → 插件页面
2. 或将文件夹放到 `~/.hanako/plugins/` 目录
3. 在插件设置中启用"允许全权插件"开关

## 配置

### 1. Runway ML

1. 访问 [Runway ML](https://runwayml.com/) 获取API密钥
2. 在插件设置中填入 Runway API Key
3. 选择 provider 为 "runway"

### 2. Pika Labs

1. 访问 [Pika Labs](https://pika.art/) 获取API密钥
2. 在插件设置中填入 Pika API Key
3. 选择 provider 为 "pika"

### 3. 可灵AI (Kling)

1. 访问 [可灵AI](https://klingai.com/) 获取API密钥
2. 在插件设置中填入 Kling API Key
3. 选择 provider 为 "kling"

### 4. ComfyUI (本地)

1. 安装并启动 [ComfyUI](https://github.com/comfyanonymous/ComfyUI)
2. 确保 ComfyUI 运行在 `http://127.0.0.1:8188`（或配置自定义地址）
3. 安装视频生成相关的自定义节点（如 AnimateDiff）
4. 选择 provider 为 "comfyui"

### 5. 自定义API

如果你有自己的视频生成API服务：

1. 在插件设置中填入自定义API URL
2. 如需要，填入API Key
3. 选择 provider 为 "custom"

API应接受以下格式的POST请求：

```json
{
  "prompt": "视频描述",
  "duration": 5,
  "resolution": "1080p",
  "image_url": "起始图片URL（可选）",
  "fps": 24,
  "style": "realistic",
  "negative_prompt": "负面提示词"
}
```

返回格式：

```json
{
  "video_url": "生成的视频URL",
  "thumbnail_url": "缩略图URL（可选）"
}
```

## 使用方法

### 通过对话使用

直接告诉 Agent 你想生成什么视频：

```
生成一个5秒的视频：日落时分，海浪拍打着沙滩，海鸥在天空飞翔
```

```
用这张图片生成一个动画视频，让画面中的人物动起来
```

### 高级参数

```
生成视频：
- 提示词：未来城市的空中交通，飞行汽车穿梭在摩天大楼之间
- 时长：10秒
- 分辨率：4k
- 风格：cinematic
- 负面提示词：模糊、低质量、变形
```

## 配置选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| provider | string | runway | 视频生成服务 |
| runwayApiKey | string | - | Runway ML API密钥 |
| pikaApiKey | string | - | Pika Labs API密钥 |
| klingApiKey | string | - | 可灵AI API密钥 |
| comfyuiUrl | string | http://127.0.0.1:8188 | ComfyUI服务地址 |
| customApiUrl | string | - | 自定义API地址 |
| customApiKey | string | - | 自定义API密钥 |
| defaultDuration | number | 5 | 默认视频时长（秒） |
| defaultResolution | string | 1080p | 默认分辨率 |
| maxConcurrent | number | 2 | 最大并发任务数 |

## API端点

插件提供以下HTTP端点（需要 full-access 权限）：

- `GET /api/plugins/video-gen/tasks` - 获取任务列表
- `GET /api/plugins/video-gen/tasks/:id` - 获取单个任务
- `DELETE /api/plugins/video-gen/tasks/:id` - 删除任务
- `GET /api/plugins/video-gen/config` - 获取配置
- `POST /api/plugins/video-gen/config` - 更新配置
- `POST /api/plugins/video-gen/test-connection` - 测试连接

## 工具说明

### video-gen_generate-video

生成视频的主要工具。

**参数：**

- `prompt` (必需): 视频生成提示词
- `imageUrl` (可选): 起始图片URL，用于图片到视频模式
- `duration` (可选): 视频时长（秒），1-30
- `resolution` (可选): 分辨率，可选 720p/1080p/4k
- `fps` (可选): 帧率，12-60
- `style` (可选): 视频风格
- `negativePrompt` (可选): 负面提示词

## 故障排除

### ComfyUI 连接失败

1. 确认 ComfyUI 正在运行
2. 检查端口是否正确（默认8188）
3. 确保防火墙允许连接
4. 使用测试连接功能验证

### API 调用失败

1. 检查 API Key 是否正确
2. 确认账户有足够的配额
3. 检查网络连接
4. 查看插件日志获取详细错误信息

### 视频生成超时

1. 增加超时时间（修改代码中的 maxAttempts）
2. 减少视频时长或降低分辨率
3. 检查服务器负载

## 开发计划

- [ ] 支持更多视频生成服务
- [ ] 批量生成功能
- [ ] 视频编辑和后处理
- [ ] 自定义ComfyUI工作流
- [ ] 进度实时显示
- [ ] 视频预览和管理界面

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 相关链接

- [Runway ML](https://runwayml.com/)
- [Pika Labs](https://pika.art/)
- [可灵AI](https://klingai.com/)
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI)
- [Hanako 插件开发文档](../../PLUGINS.md)
