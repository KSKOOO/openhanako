import { Capacitor, registerPlugin } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

const HanakoHttp = registerPlugin("HanakoHttp");

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function isNativeAndroid() {
  return Capacitor.getPlatform() === "android";
}

export async function requestJson({ url, method = "GET", headers = {}, data, timeout = 60000 } = {}) {
  if (isNativeAndroid()) {
    const response = await HanakoHttp.request({ url, method, headers, data, timeout });
    const payload = parseMaybeJson(response?.data);
    if (response?.ok && response.statusCode >= 200 && response.statusCode < 300) return payload;
    throw new Error(payload?.error?.message || payload?.message || response?.message || `HTTP ${response?.statusCode || "unknown"}`);
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: data == null || method.toUpperCase() === "GET" ? undefined : JSON.stringify(data),
      signal: controller?.signal
    });
    const text = await response.text();
    const payload = parseMaybeJson(text);
    if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
    return payload;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function chooseImages({ maxCount = 4, maxSizeMb = 12 } = {}) {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = maxCount > 1;
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", async () => {
      try {
        const files = Array.from(input.files || []).slice(0, maxCount);
        resolve(await readImageFiles(files, { maxSizeMb }));
      } catch (error) {
        reject(error);
      } finally {
        input.remove();
      }
    }, { once: true });
    input.click();
  });
}

export async function readImageFiles(files, { maxSizeMb = 12 } = {}) {
  const maxBytes = Math.max(1, Number(maxSizeMb) || 12) * 1024 * 1024;
  const list = Array.from(files || []);
  const invalid = list.find((file) => !String(file.type || "").startsWith("image/"));
  if (invalid) throw new Error(`不支持的文件类型：${invalid.name || invalid.type}`);
  const oversized = list.find((file) => file.size > maxBytes);
  if (oversized) throw new Error(`图片过大：${oversized.name || "image"} 超过 ${maxSizeMb}MB`);
  return Promise.all(list.map(readImageFile));
}

export function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (!match) return reject(new Error("图片读取失败"));
      resolve({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        name: file.name || "image.png",
        mimeType: match[1],
        base64Data: match[2],
        src: dataUrl,
        size: file.size
      });
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

export async function downloadText(filename, text, mime = "application/json") {
  if (isNativeAndroid()) {
    const path = `exports/${filename}`;
    const written = await Filesystem.writeFile({
      path,
      data: String(text || ""),
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      recursive: true
    });
    await Share.share({
      title: filename,
      text: "Hanako Android 导出数据",
      url: written.uri,
      dialogTitle: "导出 Hanako 手机端数据"
    });
    return written.uri;
  }

  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return url;
}
