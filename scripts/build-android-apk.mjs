#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const sdk = process.env.ANDROID_HOME || path.join(homedir(), "Library", "Android", "sdk");
const javaHome = process.env.JAVA_HOME || "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home";
const ndkRoot = path.join(sdk, "ndk");
const ndk = newestDirectory(ndkRoot);

if (!existsSync(path.join(javaHome, "bin", "java"))) {
  fail(`Java 17 non trovato in ${javaHome}. Installa openjdk@17 o imposta JAVA_HOME.`);
}
if (!ndk) {
  fail(`Android NDK non trovato in ${ndkRoot}. Completa prima l'installazione dell'Android SDK.`);
}

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: sdk,
  ANDROID_SDK_ROOT: sdk,
  NDK_HOME: ndk,
};
const tauri = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "tauri.cmd" : "tauri");
if (!existsSync(tauri)) {
  fail("Tauri CLI non trovata. Esegui `npm install` nella cartella del progetto e riprova.");
}
const result = spawnSync(tauri, ["android", "build", "--apk", "--target", "aarch64"], {
  cwd: root,
  env,
  stdio: "inherit",
});
if (result.error) fail(`Impossibile avviare Tauri CLI: ${result.error.message}`);
if (result.status !== 0) process.exit(result.status ?? 1);

const apk = path.join(
  root,
  "src-tauri",
  "gen",
  "android",
  "app",
  "build",
  "outputs",
  "apk",
  "universal",
  "release",
  "app-universal-release.apk",
);
if (!existsSync(apk)) fail(`Build completata, ma APK non trovato in ${apk}`);

const outputDir = process.env.MOONYTASK_ARTIFACTS_DIR || path.join(homedir(), "Desktop", "MoonyTask");
mkdirSync(outputDir, { recursive: true });
const destination = path.join(outputDir, "MoonyTask-android.apk");
copyFileSync(apk, destination);
console.log(`APK copiato in ${destination}`);

function newestDirectory(parent) {
  if (!existsSync(parent)) return null;
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(parent, entry.name, "toolchains")))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .at(-1)
    ?.replace(/^/, `${parent}${path.sep}`) ?? null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
