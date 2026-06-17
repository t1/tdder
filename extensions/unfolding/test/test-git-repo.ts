import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTestTempDir } from "./test-temp.ts";

export function makeTestGitRepo(prefix: string): { cwd: string; head: string } {
  const cwd = makeTestTempDir(prefix);
  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd, stdio: "ignore" });
  mkdirSync(join(cwd, "docs"), { recursive: true });
  writeFileSync(join(cwd, "docs", "README.md"), "seed\n");
  execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "seed"], { cwd, stdio: "ignore" });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  return { cwd, head };
}
