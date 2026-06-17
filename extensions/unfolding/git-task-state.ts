import { execFileSync } from "node:child_process";

const GIT_COMMIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "pi unfolding",
  GIT_AUTHOR_EMAIL: "pi-unfolding@local.invalid",
  GIT_COMMITTER_NAME: "pi unfolding",
  GIT_COMMITTER_EMAIL: "pi-unfolding@local.invalid",
};

function gitOk(cwd: string, args: string[]): boolean {
  try {
    execFileSync("git", args, { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export interface GitBootstrapResult {
  head: string;
  initializedRepo: boolean;
  createdInitialCommit: boolean;
}

export function ensureGitRepoWithHead(cwd: string): GitBootstrapResult {
  let initializedRepo = false;
  let createdInitialCommit = false;

  if (!gitOk(cwd, ["rev-parse", "--is-inside-work-tree"])) {
    execFileSync("git", ["init"], { cwd, stdio: "ignore" });
    initializedRepo = true;
  }

  if (!gitOk(cwd, ["rev-parse", "--verify", "HEAD"])) {
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "--allow-empty", "-m", "unfolding init"], {
      cwd,
      stdio: "ignore",
      env: GIT_COMMIT_ENV,
    });
    createdInitialCommit = true;
  }

  return {
    head: currentHeadSha(cwd),
    initializedRepo,
    createdInitialCommit,
  };
}

export function currentHeadSha(cwd: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
}

export function isWorkspaceDirty(cwd: string): boolean {
  return execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).trim().length > 0;
}

export function createSnapshotCommit(cwd: string): string {
  execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "unfolding snapshot"], {
    cwd,
    stdio: "ignore",
    env: GIT_COMMIT_ENV,
  });
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
