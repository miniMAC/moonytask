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
const workflow = "build-artifacts.yml";
const workflowPath = path.join(projectRoot, ".github", "workflows", workflow);
const artifactExtensions = new Set([".dmg", ".msi", ".exe", ".AppImage", ".deb", ".rpm"]);

main();

function main() {
  requireCommand("gh", "GitHub CLI non trovato. Installa con: brew install gh");
  requireWorkflowCommitted();

  run("gh", ["auth", "status"], {
    errorMessage: "GitHub CLI non autenticato. Esegui: gh auth login",
  });

  const branch = output("git", ["branch", "--show-current"]).trim();
  if (!branch) {
    fail("Non riesco a determinare il branch corrente. Passa a un branch prima di lanciare la CI.");
  }
  requireBranchPushed();

  const startedAt = Date.now();
  console.log(`Launching ${workflow} on branch ${branch}...`);
  run("gh", ["workflow", "run", workflow, "--ref", branch]);

  const runId = waitForRunId(branch, startedAt);
  console.log(`Watching GitHub Actions run ${runId}...`);
  run("gh", ["run", "watch", String(runId), "--exit-status"]);

  const desktopDir = resolveDesktopDir();
  const outDir = path.join(desktopDir, "MoonyTask");
  const runDir = path.join(outDir, `github-run-${runId}`);
  mkdirSync(runDir, { recursive: true });

  console.log(`Downloading artifacts to ${runDir}...`);
  run("gh", ["run", "download", String(runId), "--dir", runDir]);

  const copied = copyArtifactsToDesktop(runDir, outDir);
  if (copied === 0) {
    fail(`Build completata, ma non ho trovato artifact scaricabili in ${runDir}`);
  }

  console.log(`Done. ${copied} file ready in ${outDir}`);
}

function requireCommand(command, message) {
  const result = spawnSync(command, ["--version"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    fail(message);
  }
}

function requireWorkflowCommitted() {
  if (!existsSync(workflowPath)) {
    fail(`Workflow mancante: ${workflowPath}`);
  }

  const status = output("git", ["status", "--porcelain", "--", workflowPath]).trim();
  if (status) {
    fail(
      [
        "La workflow GitHub Actions deve essere committata e pushata prima di poterla lanciare.",
        "Fai commit/push di .github/workflows/build-artifacts.yml, poi rilancia questo task.",
      ].join("\n")
    );
  }
}

function requireBranchPushed() {
  const status = output("git", ["status", "-sb"]);
  if (status.includes("[ahead ")) {
    fail("Ci sono commit locali non pushati. Esegui git push, poi rilancia questo task.");
  }
}

function waitForRunId(branch, startedAt) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    sleep(2000);
    const runs = JSON.parse(
      output("gh", [
        "run",
        "list",
        "--workflow",
        workflow,
        "--branch",
        branch,
        "--event",
        "workflow_dispatch",
        "--limit",
        "10",
        "--json",
        "databaseId,createdAt,status",
      ])
    );

    const run = runs.find((candidate) => {
      const createdAt = new Date(candidate.createdAt).getTime();
      return createdAt >= startedAt - 120000;
    });

    if (run) {
      return run.databaseId;
    }
  }

  fail("Workflow lanciata, ma non riesco a trovare la run GitHub Actions appena creata.");
}

function copyArtifactsToDesktop(sourceDir, outDir) {
  mkdirSync(outDir, { recursive: true });
  let copied = 0;
  for (const artifact of findArtifacts(sourceDir)) {
    const destination = path.join(outDir, path.basename(artifact));
    copyFileSync(artifact, destination);
    copied += 1;
    console.log(`Copied ${artifact} -> ${destination}`);
  }
  return copied;
}

function findArtifacts(root) {
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

      const extension = fullPath.endsWith(".AppImage") ? ".AppImage" : path.extname(fullPath);
      if (artifactExtensions.has(extension)) {
        out.push(fullPath);
      }
    }
  }
  return out.sort();
}

function output(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(result.stderr || result.stdout || `${command} ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(options.errorMessage ?? `${command} ${args.join(" ")} failed`);
  }
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

  const candidates = [path.join(homedir(), "Desktop"), path.join(homedir(), "Scrivania")];
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

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
