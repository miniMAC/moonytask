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
const androidRoot = path.join(root, "src-tauri", "gen", "android");
const signingProperties = path.join(androidRoot, "keystore.properties");
const expectedCertificateSha256 =
  "30b9fd9535f4478954007941267ba782275a7a514a9b5cfc4526b96579725ccb";

if (!existsSync(path.join(javaHome, "bin", "java"))) {
  fail(`Java 17 non trovato in ${javaHome}. Installa openjdk@17 o imposta JAVA_HOME.`);
}
if (!ndk) {
  fail(`Android NDK non trovato in ${ndkRoot}. Completa prima l'installazione dell'Android SDK.`);
}
if (!existsSync(signingProperties)) {
  fail(
    [
      `Firma Android release non configurata: manca ${signingProperties}.`,
      "Non genero un APK con una chiave provvisoria perché Android non potrebbe aggiornare l'app.",
      "Segui la sezione “Firma Android” in README.md.",
    ].join("\n"),
  );
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
verifyApkCertificate(apk);

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

function verifyApkCertificate(apk) {
  const buildToolsRoot = path.join(sdk, "build-tools");
  const buildTools = newestDirectoryWithFile(buildToolsRoot, "apksigner");
  if (!buildTools) {
    fail(`apksigner non trovato in ${buildToolsRoot}.`);
  }

  const verifier = spawnSync(path.join(buildTools, "apksigner"), [
    "verify",
    "--print-certs",
    apk,
  ], {
    cwd: root,
    encoding: "utf8",
  });
  if (verifier.error) fail(`Impossibile verificare la firma APK: ${verifier.error.message}`);
  if (verifier.status !== 0) {
    fail(verifier.stderr || verifier.stdout || "Verifica firma APK non riuscita.");
  }

  const certificate = verifier.stdout.match(
    /Signer #1 certificate SHA-256 digest:\s*([0-9a-f]+)/i,
  )?.[1]?.toLowerCase();
  if (certificate !== expectedCertificateSha256) {
    fail(
      [
        "APK firmato con un certificato Android inatteso.",
        `Atteso: ${expectedCertificateSha256}`,
        `Trovato: ${certificate ?? "non rilevato"}`,
        "La build è stata fermata per evitare un altro conflitto con le installazioni esistenti.",
      ].join("\n"),
    );
  }
  console.log(`Firma Android verificata: ${certificate}`);
}

function newestDirectoryWithFile(parent, fileName) {
  if (!existsSync(parent)) return null;
  return readdirSync(parent, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(path.join(parent, entry.name, fileName)),
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .at(-1)
    ?.replace(/^/, `${parent}${path.sep}`) ?? null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
