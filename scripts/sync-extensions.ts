#!/usr/bin/env tsx

import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const extensionsDir = join(root, "extensions");

const extensionDirs = readdirSync(extensionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(extensionsDir, entry.name))
  .filter((dir) => {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      return !!pkg.scripts?.sync;
    } catch {
      return false;
    }
  })
  .sort();

if (extensionDirs.length === 0) {
  console.log("No extension sync scripts found.");
  process.exit(0);
}

for (const dir of extensionDirs) {
  const name = dir.slice(extensionsDir.length + 1);
  console.log(`==> syncing ${name}`);
  const result = spawnSync("npm", ["run", "sync"], {
    cwd: dir,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
