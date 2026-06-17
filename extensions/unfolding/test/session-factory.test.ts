import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {join} from "node:path";
import {AuthStorage, ModelRegistry} from "@earendil-works/pi-coding-agent";
import {readTaskSnapshot, startChildSession} from "../session-factory.ts";
import {restoreChildSession} from "../session-restore.ts";
import {cleanupTestTempDir, makeNonRepoTestTempDir} from "./test-temp.ts";
import {makeTestGitRepo} from "./test-git-repo.ts";
import {fauxAssistantMessage, fauxToolCall, registerFauxProvider} from "./faux-provider.ts";

function nestedDelegateToolFactory(_shortRole: string) {
  return {
    name: "task_delegate",
    label: "Task delegate",
    description: "stub",
    parameters: {type: "object", properties: {}},
    async execute() {
      return {content: [{type: "text", text: "stub"}], details: {}};
    },
  };
}

function fauxSessionSetup(name: string) {
  const provider = `${name}-${Date.now()}`;
  const faux = registerFauxProvider({
    provider,
    models: [{id: "test-model"}],
  });
  faux.setResponses([
    fauxAssistantMessage([
      fauxToolCall("task_block", {blocked_reason: "need input"}),
    ], {stopReason: "toolUse"}),
    fauxAssistantMessage("blocked"),
  ]);
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(provider, "test-key");
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  return {faux, authStorage, modelRegistry};
}

describe("startChildSession groundwork", () => {
  it("creates a task with session_file and base_sha persisted", async () => {
    const {cwd, head} = makeTestGitRepo("session-factory");
    const {faux, authStorage, modelRegistry} = fauxSessionSetup("session-factory");
    try {
      const resultPromise = startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-task",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {
        },
        nestedDelegateToolFactory,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      const deadline = Date.now() + 10000;
      let snapshot = null;
      while (Date.now() < deadline) {
        snapshot = readTaskSnapshot(cwd, "coder-task");
        if (snapshot?.session_file) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      assert.ok(snapshot, "task should exist");
      assert.ok(snapshot?.session_id, "task should persist session_id");
      assert.ok(snapshot?.session_file, "task should persist session_file");
      assert.equal((snapshot as any)?.base_sha, head, "task should persist the git HEAD as base_sha");

      const result = await resultPromise;
      assert.equal(result.outcome, "blocked");
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("initializes a git repo before persisting base_sha when the workspace has none", async () => {
    const cwd = makeNonRepoTestTempDir("session-factory");
    const {faux, authStorage, modelRegistry} = fauxSessionSetup("session-init-git");
    try {
      mkdirSync(join(cwd, "docs"), {recursive: true});
      writeFileSync(join(cwd, "docs", "README.md"), "seed\n");

      const output: string[] = [];
      const resultPromise = startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-init-git",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: (line: string) => {
          output.push(line);
        },
        nestedDelegateToolFactory,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      const deadline = Date.now() + 10000;
      let snapshot = null;
      while (Date.now() < deadline) {
        snapshot = readTaskSnapshot(cwd, "coder-init-git");
        if (snapshot?.base_sha) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      assert.ok(snapshot, "task should exist");
      assert.match(snapshot?.base_sha ?? "", /^[0-9a-f]{40}$/);
      assert.equal(
        execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {cwd, encoding: "utf8"}).trim(),
        "true",
        "startChildSession should initialize git when needed",
      );
      assert.equal(
        execFileSync("git", ["rev-parse", "HEAD"], {cwd, encoding: "utf8"}).trim(),
        snapshot?.base_sha,
        "initialized repository HEAD should be persisted as base_sha",
      );

      const result = await resultPromise;
      assert.equal(result.outcome, "blocked");
      assert.ok(
        output.includes("  ℹ unfolding initialized a local git repository for rollback support"),
        "startChildSession should emit a user-visible git initialization note",
      );
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("keeps snapshot_sha unset when the workspace is clean", async () => {
    const {cwd, head: baseHead} = makeTestGitRepo("session-factory");
    const {faux, authStorage, modelRegistry} = fauxSessionSetup("session-clean");
    try {
      const resultPromise = startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-clean",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {
        },
        nestedDelegateToolFactory,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      const deadline = Date.now() + 10000;
      let snapshot = null;
      while (Date.now() < deadline) {
        snapshot = readTaskSnapshot(cwd, "coder-clean");
        if (snapshot?.session_file) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      assert.ok(snapshot, "task should exist");
      assert.equal((snapshot as any)?.base_sha, baseHead, "task should persist base_sha");
      assert.equal((snapshot as any)?.snapshot_sha, undefined, "task should leave snapshot_sha unset in a clean workspace");
      assert.equal(
        execFileSync("git", ["rev-parse", "HEAD"], {cwd, encoding: "utf8"}).trim(),
        baseHead,
        "clean delegate start should not create a snapshot commit",
      );

      const result = await resultPromise;
      assert.equal(result.outcome, "blocked");
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("creates and persists snapshot_sha when the workspace is dirty", async () => {
    const {cwd, head: baseHead} = makeTestGitRepo("session-factory");
    const {faux, authStorage, modelRegistry} = fauxSessionSetup("session-snapshot");
    try {
      writeFileSync(join(cwd, "docs", "README.md"), "seed\nchanged before delegate\n");
      writeFileSync(join(cwd, "notes.txt"), "untracked before delegate\n");

      const resultPromise = startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-snapshot",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {
        },
        nestedDelegateToolFactory,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      const deadline = Date.now() + 10000;
      let snapshot = null;
      while (Date.now() < deadline) {
        snapshot = readTaskSnapshot(cwd, "coder-snapshot");
        if ((snapshot as any)?.snapshot_sha) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      assert.ok(snapshot, "task should exist");
      assert.equal((snapshot as any)?.base_sha, baseHead, "task should keep the original base_sha");
      assert.ok((snapshot as any)?.snapshot_sha, "task should persist snapshot_sha");
      assert.notEqual((snapshot as any)?.snapshot_sha, baseHead, "snapshot_sha should differ from base_sha when snapshot commit was created");
      assert.equal(
        execFileSync("git", ["rev-parse", "HEAD"], {cwd, encoding: "utf8"}).trim(),
        (snapshot as any)?.snapshot_sha,
        "snapshot commit should become HEAD before the child starts",
      );

      const result = await resultPromise;
      assert.equal(result.outcome, "blocked");
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("blocks after repeated truncation with an honest system-generated reason", async () => {
    const {cwd} = makeTestGitRepo("session-factory");
    const provider = `session-truncation-${Date.now()}`;
    const faux = registerFauxProvider({
      provider,
      models: [{id: "test-model"}],
    });
    faux.setResponses([
      fauxAssistantMessage("first truncated response", {stopReason: "length"}),
      fauxAssistantMessage("second truncated response", {stopReason: "length"}),
    ]);
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(provider, "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    try {
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-truncation",
        body: "Do work.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {
        },
        nestedDelegateToolFactory,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      assert.equal(result.outcome, "blocked");
      const snapshot = readTaskSnapshot(cwd, "coder-truncation");
      assert.equal(
        snapshot?.blocked_reason,
        "Automatic recovery failed after repeated truncation before the child reached a checkpoint.",
      );
      assert.equal(faux.state.callCount, 2, "should retry exactly once after the first truncation");
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("restores from the real persisted session_file created by startChildSession", async () => {
    const {cwd} = makeTestGitRepo("session-factory");
    const {faux, authStorage, modelRegistry} = fauxSessionSetup("session-restore");
    try {
      const activeSessions = new Map() as any;
      const {session, outcome} = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-restore",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions,
        pi: {} as any,
        postOutput: () => {
        },
        nestedDelegateToolFactory,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      assert.equal(outcome, "blocked");
      const snapshot = readTaskSnapshot(cwd, "coder-restore");
      assert.ok(snapshot?.session_file, "task should persist session_file");

      activeSessions.delete("coder-restore");
      const restored = await restoreChildSession(cwd, "coder-restore", activeSessions, {} as any, () => {
      }, nestedDelegateToolFactory);
      assert.ok(restored, "restoreChildSession should restore a real persisted child session");
      assert.equal(restored?.sessionFile, snapshot?.session_file);
      assert.equal(restored?.sessionManager.getSessionFile(), snapshot?.session_file);
      assert.equal(session.sessionFile, snapshot?.session_file);
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("source contains nestedDelegateToolFactory seam", () => {
    const src = readFileSync(new URL("../session-factory.ts", import.meta.url).pathname, "utf8");
    assert.ok(src.includes("nestedDelegateToolFactory"));
  });
});
