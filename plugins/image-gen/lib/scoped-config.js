import fs from "fs";
import path from "path";

function getScopedConfigPath(dataDir, agentId = null) {
  return agentId
    ? path.join(dataDir, "agents", agentId, "config.json")
    : path.join(dataDir, "config.json");
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function createScopedConfigAccessor(ctx, agentId = null) {
  const resolvedAgentId = String(agentId || "").trim() || null;

  return {
    get(key) {
      const scopedPath = getScopedConfigPath(ctx.dataDir, resolvedAgentId);
      const scoped = readJson(scopedPath);
      const fallback = resolvedAgentId ? readJson(getScopedConfigPath(ctx.dataDir, null)) : null;
      const data = scoped || fallback || {};
      return key ? data[key] : data;
    },
    set(key, value) {
      const filePath = getScopedConfigPath(ctx.dataDir, resolvedAgentId);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const data = readJson(filePath) || {};
      data[key] = value;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    },
  };
}
