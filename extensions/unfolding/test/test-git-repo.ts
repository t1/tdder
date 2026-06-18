import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTestTempDir } from "./test-temp.ts";

const TEST_GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "Test User",
  GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "test@example.com",
  GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? "Test User",
  GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? "test@example.com",
};

export function makeTestGitRepo(prefix: string): { cwd: string; head: string } {
  const cwd = makeTestTempDir(prefix);
  execFileSync("git", ["init"], { cwd, stdio: "ignore", env: TEST_GIT_ENV });
  mkdirSync(join(cwd, "docs"), { recursive: true });
  writeFileSync(join(cwd, "docs", "README.md"), "seed\n");
  execFileSync("git", ["add", "."], { cwd, stdio: "ignore", env: TEST_GIT_ENV });
  execFileSync("git", ["commit", "-m", "seed"], { cwd, stdio: "ignore", env: TEST_GIT_ENV });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  return { cwd, head };
}
