import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname, "target/test-tmp");

export function makeTestTempDir(prefix: string): string {
  mkdirSync(ROOT, { recursive: true });
  return mkdtempSync(join(ROOT, `${prefix}-`));
}

export function cleanupTestTempDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
