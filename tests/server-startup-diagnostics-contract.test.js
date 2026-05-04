import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const root = process.cwd();

describe("server startup diagnostics contract", () => {
  it("records child process identity when server startup times out without output", () => {
    const mainSource = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf-8");

    expect(mainSource).toContain("Server PID:");
    expect(mainSource).toContain("Server command:");
    expect(mainSource).toContain("Server args:");
    expect(mainSource).toContain("Server child alive:");
  });

  it("keeps process diagnostics even when bootstrap already wrote output", () => {
    const mainSource = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf-8");

    expect(mainSource).toContain("function buildServerCrashDiagnostics(");
    expect(mainSource).toContain("const diagnostics = buildServerCrashDiagnostics();");
    expect(mainSource).not.toContain("if (!logs) {\n    // production 时 server");
  });

  it("waits for the server graceful shutdown contract before force killing", () => {
    const mainSource = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf-8");

    expect(mainSource).toContain("SERVER_SHUTDOWN_GRACE_MS");
    expect(mainSource).toContain("waitForProcessExit(");
    expect(mainSource).toContain("killPid(pid, true)");
    expect(mainSource).not.toContain("setTimeout(done, 3000)");
  });

  it("keeps server-info when shutdown cannot confirm the server is gone", () => {
    const mainSource = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf-8");

    expect(mainSource).toContain("let removeServerInfo = true");
    expect(mainSource).toContain("removeServerInfo = false");
    expect(mainSource).toContain("if (removeServerInfo)");
  });

  it("starts packaged and dev server through an early bootstrap entry", () => {
    const mainSource = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf-8");
    const buildSource = fs.readFileSync(path.join(root, "scripts", "build-server.mjs"), "utf-8");
    const bootstrapPath = path.join(root, "server", "bootstrap.js");

    expect(fs.existsSync(bootstrapPath)).toBe(true);
    const bootstrapSource = fs.readFileSync(bootstrapPath, "utf-8");
    expect(bootstrapSource).toContain("[server-bootstrap] process started");
    expect(bootstrapSource.indexOf("[server-bootstrap] process started")).toBeLessThan(
      bootstrapSource.indexOf("await import("),
    );
    expect(bootstrapSource).toContain("[server-bootstrap] importing server entry");
    expect(bootstrapSource).toContain("[server-bootstrap] server entry import still pending");
    expect(bootstrapSource).toContain("[server-bootstrap] server entry import completed");

    expect(mainSource).toContain("bootstrap.js");
    expect(mainSource).toContain("HANA_SERVER_ENTRY");
    expect(mainSource).toContain("resolvePackagedServerEntry");
    expect(buildSource).toContain('path.join(outDir, "bootstrap.js")');
    expect(buildSource).toContain('"$DIR/bootstrap.js"');
    expect(buildSource).toContain("runtimeServerEntryRel");
  });

  it("keeps native SQLite out of the server static import graph", () => {
    const factStoreSource = fs.readFileSync(path.join(root, "lib", "memory", "fact-store.js"), "utf-8");
    const agentSource = fs.readFileSync(path.join(root, "core", "agent.js"), "utf-8");

    expect(factStoreSource).not.toMatch(/^import\s+.*better-sqlite3/m);
    expect(factStoreSource).toContain("loadBetterSqliteDatabase");
    expect(agentSource).toContain("[agent] 4. FactStore...");
    expect(agentSource.indexOf("[agent] 4. FactStore...")).toBeLessThan(
      agentSource.indexOf("new FactStore("),
    );
  });
});
