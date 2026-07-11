#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const targetRoot = path.join(projectRoot, "src-tauri", "target");

const [platform, target, bundles] = process.argv.slice(2);

const extensionsByPlatform = {
  all: new Set([".dmg", ".msi", ".exe", ".AppImage", ".deb", ".rpm"]),
  linux: new Set([".AppImage", ".deb", ".rpm"]),
  macos: new Set([".dmg"]),
  windows: new Set([".msi", ".exe"]),
};

if (!platform || !extensionsByPlatform[platform]) {
  console.error(
    "Usage: node scripts/build-tauri-artifact.mjs <macos|windows|linux|all> <target> [bundles]"
  );
  process.exit(2);
}

if (target && target !== "--copy-only") {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const args = ["run", "tauri", "--", "build", "--target", target];
  if (bundles) {
    args.push("--bundles", bundles);
  }

  // createUpdaterArtifacts richiede la chiave di firma degli update:
  // se non è già configurata usa quella locale (vedi UPDATES.md)
  const env = { ...process.env };
  const localKey = path.join(homedir(), ".tauri", "moonytask.key");
  if (
    !env.TAURI_SIGNING_PRIVATE_KEY &&
    !env.TAURI_SIGNING_PRIVATE_KEY_PATH &&
    existsSync(localKey)
  ) {
    // La CLI Tauri corrente richiede il contenuto della chiave; leggere qui il
    // file evita di inserirlo nella command line o nei log della build.
    env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(localKey, "utf8");
    // La chiave locale del progetto è stata creata senza password: impostare
    // esplicitamente la stringa vuota evita il prompt interattivo della CLI.
    if (!("TAURI_SIGNING_PRIVATE_KEY_PASSWORD" in env)) {
      env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "";
    }
  }

  const result = spawnSync(npm, args, {
    cwd: projectRoot,
    stdio: "inherit",
    env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const desktopDir = resolveDesktopDir();
const outDir = path.join(desktopDir, "MoonyTask");
mkdirSync(outDir, { recursive: true });

const artifacts = findArtifacts(targetRoot, extensionsByPlatform[platform]);
if (artifacts.length === 0) {
  console.error(`No ${platform} artifacts found in ${targetRoot}`);
  process.exit(1);
}

for (const artifact of artifacts) {
  const destination = path.join(outDir, stableArtifactName(artifact));
  copyFileSync(artifact, destination);
  console.log(`Copied ${path.relative(projectRoot, artifact)} -> ${destination}`);
}

console.log(`Artifacts ready in ${outDir}`);

function findArtifacts(root, extensions) {
  if (!existsSync(root)) {
    return [];
  }

  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current)) {
      const fullPath = path.join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      const relative = path.relative(root, fullPath).split(path.sep).join("/");
      const isBundleArtifact = /(^|\/)release\/bundle\//.test(relative);
      const extension = appImageExtension(fullPath) ?? path.extname(fullPath);
      if (isBundleArtifact && extensions.has(extension)) {
        out.push(fullPath);
      }
    }
  }

  return out.sort();
}

function appImageExtension(filePath) {
  return filePath.endsWith(".AppImage") ? ".AppImage" : null;
}

function stableArtifactName(filePath) {
  const base = path.basename(filePath);
  if (base.endsWith(".dmg")) {
    return "MoonyTask-macOS-universal.dmg";
  }
  if (base.endsWith(".AppImage")) {
    return "MoonyTask-Linux-x64.AppImage";
  }
  if (base.endsWith(".deb")) {
    return "MoonyTask-Linux-x64.deb";
  }
  if (base.endsWith(".rpm")) {
    return "MoonyTask-Linux-x64.rpm";
  }
  if (base.endsWith(".exe")) {
    return base.includes("arm64")
      ? "MoonyTask-Windows-arm64-setup.exe"
      : "MoonyTask-Windows-x64-setup.exe";
  }
  if (base.endsWith(".msi")) {
    return base.includes("arm64")
      ? "MoonyTask-Windows-arm64.msi"
      : "MoonyTask-Windows-x64.msi";
  }
  return base;
}

function resolveDesktopDir() {
  if (process.env.MOONYTASK_ARTIFACTS_DIR) {
    return expandHome(process.env.MOONYTASK_ARTIFACTS_DIR);
  }

  if (process.platform === "linux") {
    const linuxDesktop = readLinuxDesktopDir();
    if (linuxDesktop) {
      return linuxDesktop;
    }
  }

  const candidates = [
    path.join(homedir(), "Desktop"),
    path.join(homedir(), "Scrivania"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function readLinuxDesktopDir() {
  const userDirsPath = path.join(homedir(), ".config", "user-dirs.dirs");
  if (!existsSync(userDirsPath)) {
    return null;
  }

  const contents = readFileSync(userDirsPath, "utf8");
  const match = contents.match(/^XDG_DESKTOP_DIR=(.+)$/m);
  if (!match) {
    return null;
  }

  return expandHome(match[1].trim().replace(/^"|"$/g, ""));
}

function expandHome(value) {
  return value.replace(/^\$HOME(?=\/|$)/, homedir()).replace(/^~(?=\/|$)/, homedir());
}
