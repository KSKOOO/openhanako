import os from "node:os";

// Hana 在三平台执行 AI 命令时，真实使用的 shell 固定为 bash：
//   darwin：seatbelt 沙盒脚本 shebang 是 #!/bin/bash
//   linux：bwrap 直接调用 /bin/bash
//   win32：win32-exec 只接受 Git Bash / MSYS2 / Bundled MinGit 的 bash.exe
// 因此 system prompt 里声明的 shell 固定为 bash，与用户登录 shell ($SHELL) 无关。
const HANA_EXEC_SHELL = "bash";

export function getPlatformPromptNote({
  platform = process.platform,
  osType = os.type(),
  osRelease = os.release(),
} = {}) {
  const lines = [
    `Platform: ${platform}`,
    `Shell: ${HANA_EXEC_SHELL}`,
    `OS Version: ${osType} ${osRelease}`,
  ];
  if (platform === "win32") {
    lines.push([
      "Command syntax: use bash/POSIX syntax for pipes, paths, and redirection.",
      "Discard output with /dev/null; do not use CMD's nul device unless the command is explicitly run through cmd.exe.",
    ].join(" "));
  }
  return lines.join("\n");
}
