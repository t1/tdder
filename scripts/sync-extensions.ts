#!/usr/bin/env tsx

import { spawnSync } from "node:child_process";
import { extensionsDir, findExtensionPackages } from "./shared.ts";

const extensionDirs = findExtensionPackages()
  .filter(({ packageJson }) => !!(packageJson as Record<string, Record<string, string>>).scripts?.sync)
  .map(({ dirName }) => dirName);

if (extensionDirs.length === 0) {
  console.log("No extension sync scripts found.");
  process.exit(0);
}

for (const name of extensionDirs) {
  console.log(`==> syncing ${name}`);
  const result = spawnSync("npm", ["run", "sync"], {
    cwd: `${extensionsDir}/${name}`,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
