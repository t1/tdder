import { execFileSync } from "node:child_process";

export function currentHeadSha(cwd: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
}

export function isWorkspaceDirty(cwd: string): boolean {
  return execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).trim().length > 0;
}

export function createSnapshotCommit(cwd: string): string {
  execFileSync("git", ["add", "-A"], { cwd });
  execFileSync("git", ["commit", "-m", "unfolding snapshot"], { cwd, stdio: "ignore" });
  return currentHeadSha(cwd);
}

export function restoreTaskWorkspace(cwd: string, baseSha: string, snapshotSha?: string): void {
  execFileSync("git", ["reset", "--hard", baseSha], { cwd, stdio: "ignore" });
  execFileSync("git", ["clean", "-fd"], { cwd, stdio: "ignore" });

  if (snapshotSha) {
    execFileSync("git", ["checkout", snapshotSha, "--", "."], { cwd, stdio: "ignore" });
    execFileSync("git", ["reset"], { cwd, stdio: "ignore" });
  }
}
