import { existsSync } from "node:fs";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileDir = path.join(rootDir, "mobile-android");
const androidDir = path.join(mobileDir, "android");
const toolchainDir = path.join(rootDir, ".mobile-capacitor-toolchain");
const jdkDir = path.join(toolchainDir, "jdk21");
const androidSdkDir = path.join(toolchainDir, "android-sdk");
const gradleHomeDir = path.join(toolchainDir, "gradle-home");
const apkDir = path.join(rootDir, "dist", "mobile-apk");
const finalApk = path.join(apkDir, "Hanako-Capacitor-Android-0.4.0-debug.apk");

const androidEnv = {
  JAVA_HOME: jdkDir,
  ANDROID_HOME: androidSdkDir,
  ANDROID_SDK_ROOT: androidSdkDir,
  GRADLE_USER_HOME: gradleHomeDir,
  PATH: `${path.join(jdkDir, "bin")}${path.delimiter}${path.join(androidSdkDir, "platform-tools")}${path.delimiter}${process.env.PATH || ""}`
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || rootDir,
    stdio: "inherit",
    env: { ...process.env, ...options.env }
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

if (!existsSync(mobileDir)) throw new Error("Missing mobile-android project");
if (!existsSync(androidDir)) throw new Error("Missing Capacitor android platform; run npm --prefix mobile-android install && npx cap add android");
if (!existsSync(path.join(jdkDir, "bin", "java"))) throw new Error("Missing local JDK: .mobile-capacitor-toolchain/jdk");
if (!existsSync(path.join(androidSdkDir, "platforms", "android-35", "android.jar"))) throw new Error("Missing Android SDK platform android-35");

await mkdir(gradleHomeDir, { recursive: true });
await writeFile(path.join(androidDir, "local.properties"), `sdk.dir=${androidSdkDir}\n`, "utf8");

run("npm", ["--prefix", "mobile-android", "run", "build"]);
run("npx", ["cap", "sync", "android"], { cwd: mobileDir, env: androidEnv });
run("./gradlew", ["assembleDebug"], { cwd: androidDir, env: androidEnv });

const sourceApk = path.join(androidDir, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
if (!existsSync(sourceApk)) throw new Error(`Gradle did not produce ${sourceApk}`);
await mkdir(apkDir, { recursive: true });
await copyFile(sourceApk, finalApk);
console.log(`[mobile:build:apk] ${path.relative(rootDir, finalApk)}`);
