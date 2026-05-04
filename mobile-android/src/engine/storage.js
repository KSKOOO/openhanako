const STORAGE_PREFIX = "hanako.capacitor.android.";

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export class MobileStorage {
  constructor(namespace = "default") {
    this.namespace = namespace;
  }

  key(name) {
    return `${STORAGE_PREFIX}${this.namespace}.${name}`;
  }

  read(name, fallback = null) {
    return parseJson(localStorage.getItem(this.key(name)), fallback);
  }

  write(name, value) {
    localStorage.setItem(this.key(name), JSON.stringify(value));
    return value;
  }

  remove(name) {
    localStorage.removeItem(this.key(name));
  }

  exportAll() {
    const data = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      data[key.slice(STORAGE_PREFIX.length)] = parseJson(localStorage.getItem(key), null);
    }
    return {
      app: "hanako-capacitor-android",
      version: 1,
      exportedAt: new Date().toISOString(),
      data
    };
  }

  importAll(payload) {
    const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
    for (const [key, value] of Object.entries(data)) {
      localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value));
    }
  }
}

export function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

