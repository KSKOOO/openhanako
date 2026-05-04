import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createScopedConfigAccessor } from "../lib/scoped-config.js";

describe("image-gen scoped config", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "image-gen-config-"));

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  it("reads agent-scoped config before falling back to global config", () => {
    fs.writeFileSync(
      path.join(tmpRoot, "config.json"),
      JSON.stringify({ defaultImageModel: { id: "global-model", provider: "openai" } }),
      "utf-8",
    );
    fs.mkdirSync(path.join(tmpRoot, "agents", "hana"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, "agents", "hana", "config.json"),
      JSON.stringify({ defaultImageModel: { id: "hana-model", provider: "openai" } }),
      "utf-8",
    );

    const scoped = createScopedConfigAccessor({ dataDir: tmpRoot }, "hana");
    expect(scoped.get("defaultImageModel")).toEqual({ id: "hana-model", provider: "openai" });
  });

  it("writes agent-scoped config into agents/<id>/config.json", () => {
    const scoped = createScopedConfigAccessor({ dataDir: tmpRoot }, "worker-a");
    scoped.set("providerDefaults", { openai: { quality: "high" } });

    const saved = JSON.parse(
      fs.readFileSync(path.join(tmpRoot, "agents", "worker-a", "config.json"), "utf-8"),
    );
    expect(saved.providerDefaults.openai.quality).toBe("high");
  });
});
