export function formatRelativeTime(value) {
  if (!value) return "刚刚";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "刚刚";
  const diff = Date.now() - time;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return new Date(value).toLocaleDateString("zh-CN");
}

export function summarizeMessages(messages = []) {
  const text = messages.map((message) => message.content).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return text.slice(0, 88) || "还没有消息";
}

export function extractKeywords(text = "") {
  return Array.from(new Set(String(text).match(/[\p{Script=Han}A-Za-z0-9_-]{2,}/gu) || []))
    .filter((item) => item.length <= 24)
    .slice(0, 8);
}

