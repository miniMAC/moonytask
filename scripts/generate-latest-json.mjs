#!/usr/bin/env node

// Genera downloads/latest.json per l'updater Tauri a partire dagli artefatti
// di build (locali o scaricati dalla CI), leggendo le firme .sig.
//
// Uso:
//   node scripts/generate-latest-json.mjs [--dir <cartella artefatti>] [--notes "testo"] [--allow-missing] [--desktop-only]
//
// Senza --dir usa esclusivamente la run CI registrata dal task desktop per lo
// stesso commit, evitando di riusare per errore una vecchia cartella github-run-*.
//
// Output:
//   - copia gli artefatti updater in Desktop/MoonyTask con i nomi versionati
//     usati negli URL (MoonyTask_X.Y.Z_universal.app.tar.gz, ecc.)
//   - scrive Desktop/MoonyTask/latest.json pronto da caricare via FTP
//   - se esiste, aggiorna anche ../moonytaskweb/downloads/latest.json

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const version = JSON.parse(
  readFileSync(path.join(projectRoot, "src-tauri", "tauri.conf.json"), "utf8"),
).version;
const notes = argValue("--notes") ?? "Miglioramenti e correzioni.";
const allowMissing = args.includes("--allow-missing");
const desktopOnly = args.includes("--desktop-only");
const baseUrl = "https://moonytask.com/downloads";

const desktopDir = resolveDesktopDir();
const outDir = path.join(desktopDir, "MoonyTask");
const sourceDir = argValue("--dir") ?? defaultSourceDir();
if (!existsSync(sourceDir)) {
  fail(`Cartella artefatti non trovata: ${sourceDir}`);
}
console.log(`Reading updater artifacts from ${sourceDir}`);

// nome file releasato -> chiavi platform di latest.json
const files = collectFiles(sourceDir);
const entries = [
  {
    platforms: ["darwin-aarch64", "darwin-x86_64"],
    releaseName: `MoonyTask_${version}_universal.app.tar.gz`,
    match: (name, allFiles) =>
      name.endsWith(".app.tar.gz") &&
      allFiles.some((file) =>
        path.basename(file).includes(`_${version}_universal.dmg`),
      ),
  },
  {
    platforms: ["windows-x86_64"],
    releaseName: `MoonyTask_${version}_x64-setup.exe`,
    match: (name) =>
      name.endsWith("-setup.exe") &&
      name.includes(`_${version}_`) &&
      !name.includes("arm64"),
  },
  {
    platforms: ["windows-aarch64"],
    releaseName: `MoonyTask_${version}_arm64-setup.exe`,
    match: (name) =>
      name.endsWith("-setup.exe") &&
      name.includes(`_${version}_`) &&
      name.includes("arm64"),
  },
  {
    platforms: ["linux-x86_64"],
    releaseName: `MoonyTask_${version}_amd64.AppImage`,
    match: (name) =>
      name.endsWith(".AppImage") && name.includes(`_${version}_`),
  },
];

mkdirSync(outDir, { recursive: true });

const platforms = {};
const missing = [];
for (const entry of entries) {
  const artifact = files.find((file) =>
    entry.match(path.basename(file), files),
  );
  const signatureFile = artifact ? `${artifact}.sig` : null;
  if (!artifact || !existsSync(signatureFile)) {
    missing.push(...entry.platforms);
    continue;
  }

  const destination = path.join(outDir, entry.releaseName);
  copyFileSync(artifact, destination);
  console.log(`Copied ${path.basename(artifact)} -> ${destination}`);

  const signature = readFileSync(signatureFile, "utf8").trim();
  for (const platform of entry.platforms) {
    platforms[platform] = {
      signature,
      url: `${baseUrl}/${entry.releaseName}`,
    };
  }
}

if (missing.length > 0) {
  const message = `Artefatti updater mancanti per: ${missing.join(", ")}`;
  if (!allowMissing) {
    fail(
      `${message}\nControlla la cartella ${sourceDir} oppure rilancia con --allow-missing per generare comunque il file.`,
    );
  }
  console.warn(`ATTENZIONE: ${message}`);
}

let mobile;
if (!desktopOnly) {
  const androidMetadataPath =
    argValue("--android-metadata") ??
    path.join(outDir, "MoonyTask-android.metadata.json");
  if (!existsSync(androidMetadataPath)) {
    fail(
      [
        `Metadati APK mancanti: ${androidMetadataPath}`,
        "Esegui prima la build Android release. latest.json non viene creato con una versione mobile non verificata.",
      ].join("\n"),
    );
  }
  const android = JSON.parse(readFileSync(androidMetadataPath, "utf8"));
  if (
    android.version !== version ||
    !Number.isInteger(android.versionCode) ||
    typeof android.fileName !== "string" ||
    !/^MoonyTask_[0-9A-Za-z.+-]+_android\.apk$/.test(android.fileName) ||
    !/^[0-9a-f]{64}$/.test(android.sha256) ||
    android.commitSha !== currentCommit() ||
    android.dirty !== false
  ) {
    fail(
      [
        `Metadati APK non validi o versione non allineata (${android.version ?? "mancante"} != ${version}).`,
        "Per una release, l'APK deve provenire dallo stesso commit del task desktop e da un worktree pulito.",
      ].join("\n"),
    );
  }
  const androidApk = path.resolve(
    path.dirname(androidMetadataPath),
    android.fileName,
  );
  if (!existsSync(androidApk)) {
    fail(`APK dichiarato nei metadati non trovato: ${androidApk}`);
  }
  const actualSha256 = fileSha256(androidApk);
  if (actualSha256 !== android.sha256) {
    fail(
      `Hash APK non valido per ${android.fileName}: atteso ${android.sha256}, trovato ${actualSha256}.`,
    );
  }
  mobile = {
    android: {
      version: android.version,
      versionCode: android.versionCode,
      sha256: android.sha256,
      url: `${baseUrl}/${android.fileName}`,
    },
  };
  console.log(
    `Android verificato: ${android.fileName} (${android.version}, versionCode ${android.versionCode})`,
  );
}

const latest = {
  version,
  notes,
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  ...(mobile ? { mobile } : {}),
  platforms,
};

const json = `${JSON.stringify(latest, null, 2)}\n`;
const latestPath = path.join(outDir, "latest.json");
writeFileSync(latestPath, json);
console.log(`Wrote ${latestPath}`);

// tiene allineata anche la copia nella repo del sito, così non va più
// aggiornata a mano a ogni release
const webRepoLatest = path.join(
  projectRoot,
  "..",
  "moonytaskweb",
  "downloads",
  "latest.json",
);
if (existsSync(webRepoLatest)) {
  writeFileSync(webRepoLatest, json);
  console.log(`Wrote ${webRepoLatest}`);
}

console.log(
  `latest.json ${version} pronto: carica su FTP i file in ${outDir} e per ultimo latest.json`,
);

function defaultSourceDir() {
  const metadataPath = path.join(
    outDir,
    "MoonyTask-desktop.metadata.json",
  );
  if (!existsSync(metadataPath)) {
    fail(
      [
        `Metadati build desktop mancanti: ${metadataPath}`,
        "Esegui il task completo di VS Code oppure passa esplicitamente --dir.",
      ].join("\n"),
    );
  }
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  if (
    metadata.version !== version ||
    metadata.commitSha !== currentCommit() ||
    typeof metadata.sourceDir !== "string" ||
    !existsSync(metadata.sourceDir)
  ) {
    fail(
      "La build desktop disponibile non appartiene alla versione e al commit correnti.",
    );
  }
  return metadata.sourceDir;
}

function collectFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current)) {
      const fullPath = path.join(current, entry);
      if (statSync(fullPath).isDirectory()) {
        stack.push(fullPath);
      } else {
        out.push(fullPath);
      }
    }
  }
  return out.sort();
}

function resolveDesktopDir() {
  if (process.env.MOONYTASK_ARTIFACTS_DIR) {
    return expandHome(process.env.MOONYTASK_ARTIFACTS_DIR);
  }

  if (process.platform === "linux") {
    const userDirsPath = path.join(homedir(), ".config", "user-dirs.dirs");
    if (existsSync(userDirsPath)) {
      const match = readFileSync(userDirsPath, "utf8").match(
        /^XDG_DESKTOP_DIR=(.+)$/m,
      );
      if (match) {
        return expandHome(match[1].trim().replace(/^"|"$/g, ""));
      }
    }
  }

  const candidates = [
    path.join(homedir(), "Desktop"),
    path.join(homedir(), "Scrivania"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function expandHome(value) {
  return value
    .replace(/^\$HOME(?=\/|$)/, homedir())
    .replace(/^~(?=\/|$)/, homedir());
}

function fileSha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function currentCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    fail(
      result.error?.message ||
        result.stderr?.trim() ||
        "Impossibile determinare il commit corrente.",
    );
  }
  return result.stdout.trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
