import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {
  createSnapshotCommit,
  currentHeadSha,
  ensureGitRepoWithHead,
  isWorkspaceDirty,
  restoreTaskWorkspace,
} from "../git-task-state.ts";
import {cleanupTestTempDir, makeTestTempDir} from "./test-temp.ts";
import {makeTestGitRepo} from "./test-git-repo.ts";

describe("git-task-state", () => {
  it("ensureGitRepoWithHead initializes a repo with an initial HEAD when needed", () => {
    const cwd = makeTestTempDir("git-task-state");
    try {
      writeFileSync(join(cwd, "README.md"), "seed\n");

      const bootstrap = ensureGitRepoWithHead(cwd);

      assert.equal(bootstrap.initializedRepo, true);
      assert.equal(bootstrap.createdInitialCommit, true);
      assert.match(bootstrap.head, /^[0-9a-f]{40}$/);
      assert.equal(currentHeadSha(cwd), bootstrap.head);
      assert.equal(execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {cwd, encoding: "utf8"}).trim(), "true");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("currentHeadSha returns the current HEAD", () => {
    const {cwd, head} = makeTestGitRepo("git-task-state");
    try {
      assert.equal(currentHeadSha(cwd), head);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("isWorkspaceDirty is false for a clean workspace and true for dirty changes", () => {
    const {cwd} = makeTestGitRepo("git-task-state");
    try {
      assert.equal(isWorkspaceDirty(cwd), false);
      writeFileSync(join(cwd, "docs", "README.md"), "seed\nchanged\n");
      assert.equal(isWorkspaceDirty(cwd), true);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("createSnapshotCommit captures tracked and untracked pre-task changes", () => {
    const {cwd, head: baseSha} = makeTestGitRepo("git-task-state");
    try {
      writeFileSync(join(cwd, "docs", "README.md"), "seed\nchanged before delegate\n");
      writeFileSync(join(cwd, "notes.txt"), "untracked before delegate\n");

      const snapshotSha = createSnapshotCommit(cwd);

      assert.notEqual(snapshotSha, baseSha);
      assert.equal(currentHeadSha(cwd), snapshotSha);
      assert.equal(isWorkspaceDirty(cwd), false, "snapshot commit should leave a clean workspace");
      assert.equal(readFileSync(join(cwd, "docs", "README.md"), "utf8"), "seed\nchanged before delegate\n");
      assert.equal(readFileSync(join(cwd, "notes.txt"), "utf8"), "untracked before delegate\n");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("restoreTaskWorkspace restores the exact pre-task state from base_sha and snapshot_sha", () => {
    const {cwd, head: baseSha} = makeTestGitRepo("git-task-state");
    try {
      writeFileSync(join(cwd, "docs", "README.md"), "seed\npre-task dirty\n");
      writeFileSync(join(cwd, "notes.txt"), "untracked before delegate\n");
      const snapshotSha = createSnapshotCommit(cwd);

      writeFileSync(join(cwd, "docs", "README.md"), "seed\ntask changed\n");
      writeFileSync(join(cwd, "task-temp.txt"), "created by task\n");

      restoreTaskWorkspace(cwd, baseSha, snapshotSha);

      assert.equal(currentHeadSha(cwd), baseSha);
      assert.equal(readFileSync(join(cwd, "docs", "README.md"), "utf8"), "seed\npre-task dirty\n");
      assert.equal(readFileSync(join(cwd, "notes.txt"), "utf8"), "untracked before delegate\n");
      assert.equal(existsSync(join(cwd, "task-temp.txt")), false);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("restoreTaskWorkspace with no snapshot_sha returns a clean base state", () => {
    const {cwd, head: baseSha} = makeTestGitRepo("git-task-state");
    try {
      writeFileSync(join(cwd, "docs", "README.md"), "seed\ntask changed\n");
      writeFileSync(join(cwd, "task-temp.txt"), "created by task\n");

      restoreTaskWorkspace(cwd, baseSha);

      assert.equal(currentHeadSha(cwd), baseSha);
      assert.equal(readFileSync(join(cwd, "docs", "README.md"), "utf8"), "seed\n");
      assert.equal(existsSync(join(cwd, "task-temp.txt")), false);
      assert.equal(isWorkspaceDirty(cwd), false);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});
