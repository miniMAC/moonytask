#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const gh = resolveCommand("gh", ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"]);
if (!gh) {
  console.error("GitHub CLI non trovato. Installa con: brew install gh");
  process.exit(1);
}

const result = spawnSync(gh, ["auth", "login"], { stdio: "inherit" });
process.exit(result.status ?? 1);

function resolveCommand(command, candidates = []) {
  for (const candidate of [command, ...candidates]) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (!result.error && result.status === 0) {
      return candidate;
    }
  }
  return null;
}
