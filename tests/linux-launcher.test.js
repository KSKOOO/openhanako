import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { buildLinuxLauncher } = require("../scripts/linux-launcher.cjs");

function createPortableFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hanako-linux-launcher-"));
  const launcherPath = path.join(root, "hanako");
  const binaryPath = path.join(root, "hanako-bin");
  const sandboxPath = path.join(root, "chrome-sandbox");

  fs.writeFileSync(binaryPath, [
    "#!/bin/sh",
    'if [ "${HANAKO_TEST_SANDBOX_CRASH:-0}" = "1" ]; then',
    '  case " $* " in',
    '    *" --no-sandbox "*) ;;',
    '    *)',
    '      printf "[12345:FATAL:content/browser/zygote_host/zygote_host_impl_linux.cc:132] No usable sandbox!\\\\n" >&2',
    "      exit 133",
    "      ;;",
    "  esac",
    "fi",
    'printf "fallback=%s\\n" "${HANAKO_ELECTRON_SANDBOX_FALLBACK:-none}"',
    'printf "args=%s\\n" "$*"',
    "",
  ].join("\n"), "utf-8");
  fs.chmodSync(binaryPath, 0o755);

  fs.writeFileSync(sandboxPath, "#!/bin/sh\nexit 0\n", "utf-8");
  fs.chmodSync(sandboxPath, 0o4755);

  fs.writeFileSync(launcherPath, buildLinuxLauncher({
    productName: "Hanako",
    binaryName: "hanako-bin",
  }), "utf-8");
  fs.chmodSync(launcherPath, 0o755);

  return {
    root,
    launcherPath,
  };
}

function runLauncher(env) {
  const fixture = createPortableFixture();
  try {
    const result = spawnSync(fixture.launcherPath, ["--probe"], {
      cwd: fixture.root,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: fixture.root,
        XDG_CACHE_HOME: path.join(fixture.root, ".cache"),
        ...env,
      },
    });
    return result;
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

describe("linux launcher sandbox fallback", () => {
  it("uses --disable-setuid-sandbox for portable builds when user namespaces are available", () => {
    const result = runLauncher({ HANAKO_FORCE_USERNS: "1" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("fallback=disable-setuid-sandbox");
    expect(result.stdout).toContain("args=--disable-setuid-sandbox --probe");
    expect(result.stderr).toContain("falling back to --disable-setuid-sandbox");
  });

  it("uses --no-sandbox only when neither setuid nor user namespaces are usable", () => {
    const result = runLauncher({ HANAKO_FORCE_USERNS: "0" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("fallback=no-sandbox");
    expect(result.stdout).toContain("args=--no-sandbox --probe");
    expect(result.stderr).toContain("falling back to --no-sandbox");
  });

  it("retries with --no-sandbox when Chromium aborts during sandbox startup", () => {
    const result = runLauncher({
      HANAKO_FORCE_USERNS: "1",
      HANAKO_TEST_SANDBOX_CRASH: "1",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("fallback=no-sandbox");
    expect(result.stdout).toContain("args=--no-sandbox --probe");
    expect(result.stderr).toContain("retrying with --no-sandbox");
  });
});
