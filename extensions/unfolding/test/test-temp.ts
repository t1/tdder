import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname, "target/test-tmp");
const NON_REPO_ROOT = resolve(ROOT, "../../../../../target/test-tmp-outside-repo");

export function makeTestTempDir(prefix: string): string {
  mkdirSync(ROOT, { recursive: true });
  return mkdtempSync(join(ROOT, `${prefix}-`));
}

export function makeNonRepoTestTempDir(prefix: string): string {
  mkdirSync(NON_REPO_ROOT, { recursive: true });
  return mkdtempSync(join(NON_REPO_ROOT, `${prefix}-`));
}

export function cleanupTestTempDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
