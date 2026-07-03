import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname, "target/test-tmp");

// Prevent the SDK from loading real user extensions (e.g. the idea MCP extension
// that opens TCP connections to IntelliJ) in child sessions created by tests.
// Without this, the process hangs after all tests finish because the MCP client
// keeps its sockets open.
const EMPTY_AGENT_DIR = resolve(new URL("..", import.meta.url).pathname, "target/empty-agent-dir");
if (!process.env.PI_CODING_AGENT_DIR) {
  mkdirSync(EMPTY_AGENT_DIR, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = EMPTY_AGENT_DIR;
}

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
