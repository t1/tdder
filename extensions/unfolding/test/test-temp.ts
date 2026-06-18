import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname, "target/test-tmp");

function ensureGitCeilingDirectories(): void {
  const current = process.env.GIT_CEILING_DIRECTORIES?.split(delimiter).filter(Boolean) ?? [];
  if (!current.includes(ROOT)) {
    process.env.GIT_CEILING_DIRECTORIES = [...current, ROOT].join(delimiter);
  }
}

export function makeTestTempDir(prefix: string): string {
  mkdirSync(ROOT, { recursive: true });
  ensureGitCeilingDirectories();
  return mkdtempSync(join(ROOT, `${prefix}-`));
}

export function cleanupTestTempDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
