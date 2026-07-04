import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {join, resolve} from "node:path";
import {AuthStorage, ModelRegistry} from "@earendil-works/pi-coding-agent";
import {readTaskSnapshot, startChildSession} from "../session-factory.ts";
import { CHILD_SESSION_FAILURE_BLOCKED_REASON, MISSING_CHECKPOINT_BLOCKED_REASON } from "../task-delegate.ts";
import {restoreChildSession} from "../session-restore.ts";
import {cleanupTestTempDir, makeTestTempDir} from "./test-temp.ts";
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
    const cwd = makeTestTempDir("session-factory");
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

  it("does not misclassify toolUse turns as missing checkpoints while the child is still working", async () => {
    const {cwd} = makeTestGitRepo("session-factory");
    const provider = `session-tooluse-${Date.now()}`;
    const faux = registerFauxProvider({
      provider,
      models: [{id: "test-model"}],
    });
    faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall("write", { path: "docs/product.md", content: "brief" }),
      ], {stopReason: "toolUse"}),
      fauxAssistantMessage([
        fauxToolCall("task_finished", {}),
      ], {stopReason: "toolUse"}),
    ]);
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(provider, "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    try {
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-tooluse",
        body: "Write docs/product.md, then call task_finished.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {
        },
        nestedDelegateToolFactory,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      assert.equal(result.outcome, "finished");
      assert.equal(faux.state.callCount, 3, "current faux-provider flow still consumes one extra follow-up turn before reaching the next toolUse response");
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("prompts once after a missing checkpoint and succeeds when the child then calls task_finished", async () => {
    const {cwd} = makeTestGitRepo("session-factory");
    const provider = `session-missing-checkpoint-${Date.now()}`;
    const faux = registerFauxProvider({
      provider,
      models: [{id: "test-model"}],
    });
    faux.setResponses([
      fauxAssistantMessage("I am done but forgot the checkpoint."),
      fauxAssistantMessage([
        fauxToolCall("task_finished", {}),
      ], {stopReason: "toolUse"}),
    ]);
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(provider, "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    try {
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-missing-checkpoint",
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

      assert.equal(result.outcome, "finished");
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("blocks after repeated missing checkpoints with an honest system-generated reason", async () => {
    const {cwd} = makeTestGitRepo("session-factory");
    const provider = `session-missing-checkpoint-block-${Date.now()}`;
    const faux = registerFauxProvider({
      provider,
      models: [{id: "test-model"}],
    });
    faux.setResponses([
      fauxAssistantMessage("still forgot the checkpoint"),
      fauxAssistantMessage("forgot again"),
    ]);
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(provider, "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    try {
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-missing-checkpoint-block",
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
      const snapshot = readTaskSnapshot(cwd, "coder-missing-checkpoint-block");
      assert.equal(snapshot?.blocked_reason, MISSING_CHECKPOINT_BLOCKED_REASON);
      assert.equal(faux.state.callCount, 2, "should retry exactly once after the first missing checkpoint");
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("blocks on child-session technical failure instead of treating it as a missing checkpoint", async () => {
    const {cwd} = makeTestGitRepo("session-factory");
    const provider = `session-child-failure-${Date.now()}`;
    const faux = registerFauxProvider({
      provider,
      models: [{id: "test-model"}],
    });
    faux.setResponses([
      fauxAssistantMessage("transport failed", {stopReason: "error", errorMessage: "Permission denied."} as any),
    ]);
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(provider, "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    try {
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-child-failure",
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
      const snapshot = readTaskSnapshot(cwd, "coder-child-failure");
      assert.equal(snapshot?.status, "blocked", "technical child failure should block the task");
      assert.match(snapshot?.blocked_reason ?? "", new RegExp(`^${CHILD_SESSION_FAILURE_BLOCKED_REASON.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      assert.match(snapshot?.blocked_reason ?? "", /Permission denied\./);
      assert.equal(faux.state.callCount, 1, "should stop immediately on child-session failure");
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("blocks unknown aborted child-session failures as technical failures", async () => {
    const {cwd} = makeTestGitRepo("session-factory");
    const provider = `session-child-aborted-${Date.now()}`;
    const faux = registerFauxProvider({
      provider,
      models: [{id: "test-model"}],
    });
    faux.setResponses([
      fauxAssistantMessage("transport aborted", {stopReason: "aborted", errorMessage: "Request was aborted."} as any),
    ]);
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(provider, "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    try {
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-child-aborted",
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
      const snapshot = readTaskSnapshot(cwd, "coder-child-aborted");
      assert.equal(snapshot?.status, "blocked");
      assert.match(snapshot?.blocked_reason ?? "", /Request was aborted\./);
      assert.equal(faux.state.callCount, 1, "raw aborted child failure without local abort evidence should block");
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("returns aborted when the child run is locally aborted via the propagated signal", async () => {
    const {cwd} = makeTestGitRepo("session-factory");
    const provider = `session-local-abort-${Date.now()}`;
    const faux = registerFauxProvider({
      provider,
      models: [{id: "test-model"}],
    });
    faux.setResponses([
      fauxAssistantMessage("transport aborted", {stopReason: "aborted", errorMessage: "Request was aborted."} as any),
    ]);
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(provider, "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    try {
      const controller = new AbortController();
      queueMicrotask(() => controller.abort());

      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-local-abort",
        body: "Do work.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {
        },
        signal: controller.signal,
        nestedDelegateToolFactory,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      assert.equal(result.outcome, "aborted");
      const snapshot = readTaskSnapshot(cwd, "coder-local-abort");
      assert.equal(snapshot?.status, "in_progress", "user-aborted tasks should keep the last persisted checkpoint");
      assert.equal(snapshot?.blocked_reason, undefined);
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("returns aborted when the child session emits an aborted terminal message after local abort without changing task status", async () => {
    const {cwd} = makeTestGitRepo("session-factory");
    const provider = `session-local-abort-terminal-${Date.now()}`;
    const faux = registerFauxProvider({
      provider,
      models: [{id: "test-model"}],
    });
    faux.setResponses([
      fauxAssistantMessage("waiting", {stopReason: "aborted", errorMessage: "aborted"} as any),
    ]);
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(provider, "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    try {
      const controller = new AbortController();
      queueMicrotask(() => controller.abort());

      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-local-abort-terminal",
        body: "Do work.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {
        },
        signal: controller.signal,
        nestedDelegateToolFactory,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      assert.equal(result.outcome, "aborted");
      const snapshot = readTaskSnapshot(cwd, "coder-local-abort-terminal");
      assert.equal(snapshot?.status, "in_progress");
      assert.equal(snapshot?.blocked_reason, undefined);
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("returns aborted when only the propagated parent signal aborts the child run", async () => {
    const {cwd} = makeTestGitRepo("session-factory");
    const provider = `session-parent-signal-abort-${Date.now()}`;
    const faux = registerFauxProvider({
      provider,
      models: [{id: "test-model"}],
    });
    faux.setResponses([
      fauxAssistantMessage("waiting", {stopReason: "aborted", errorMessage: "aborted"} as any),
    ]);
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(provider, "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    try {
      const controller = new AbortController();
      queueMicrotask(() => controller.abort());

      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-parent-signal-abort",
        body: "Do work.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {
        },
        parentSignal: controller.signal,
        nestedDelegateToolFactory,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      assert.equal(result.outcome, "aborted");
      const snapshot = readTaskSnapshot(cwd, "coder-parent-signal-abort");
      assert.equal(snapshot?.status, "in_progress");
      assert.equal(snapshot?.blocked_reason, undefined);
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
      assert.equal(restored?.session.sessionFile, snapshot?.session_file);
      assert.equal(restored?.session.sessionManager.getSessionFile(), snapshot?.session_file);
      assert.equal(session.sessionFile, snapshot?.session_file);
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("child sessions exclude root-only task tools, keep ask_sensei, and load sibling pi extensions", async () => {
    const { cwd } = makeTestGitRepo("session-factory");
    const { faux, authStorage, modelRegistry } = fauxSessionSetup("session-tools");
    try {
      const activeSessions = new Map() as any;
      const { session } = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "architect",
        slug: "architect-tools",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions,
        pi: {
          __unfoldingAskSensei: async () => "5",
          __unfoldingExtensionPaths: [
            resolve(new URL("../../maven", import.meta.url).pathname),
            resolve(new URL("../../idea", import.meta.url).pathname),
          ],
        } as any,
        postOutput: () => {},
        nestedDelegateToolFactory,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      const tools = session.getAllTools().map(t => t.name);
      assert.equal(tools.includes("task_list"), false, "child session must not expose task_list");
      assert.equal(tools.includes("task_read"), false, "child session must not expose task_read");
      assert.equal(tools.includes("ask_sensei"), true, "child session should expose the proxied ask_sensei");
      assert.equal(tools.includes("maven_run"), true, "architect allowlist includes maven_run from sibling extension");
      assert.equal(tools.includes("maven_project_info"), false, "maven_project_info is not in the architect allowlist");
      assert.equal(tools.includes("maven_lookup_version"), false, "maven_lookup_version is not in the architect allowlist");
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("architect can ask Sensei directly in a child session", async () => {
    const { cwd } = makeTestGitRepo("session-factory");
    const provider = `architect-ask-${Date.now()}`;
    const faux = registerFauxProvider({ provider, models: [{ id: "test-model" }] });
    faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall("ask_sensei", { question: "Architect direct question?", options: ["A", "B"] }),
      ], { stopReason: "toolUse" }),
      fauxAssistantMessage("thanks"),
      fauxAssistantMessage([
        fauxToolCall("task_finished", {}),
      ], { stopReason: "toolUse" }),
    ]);
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(provider, "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const asks: any[] = [];

    try {
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "architect",
        slug: "architect-ask-sensei",
        body: "Immediately ask Sensei a direct question, then finish.",
        activeSessions: new Map() as any,
        pi: { __unfoldingAskSensei: async (params: any) => {
          asks.push(params);
          return "B";
        } } as any,
        postOutput: () => {},
        nestedDelegateToolFactory,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      assert.equal(result.outcome, "finished");
      assert.deepEqual(asks, [{ question: "Architect direct question?", options: ["A", "B"] }]);
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("PO can ask Sensei directly in a child session", async () => {
    const { cwd } = makeTestGitRepo("session-factory");
    const provider = `po-ask-${Date.now()}`;
    const faux = registerFauxProvider({ provider, models: [{ id: "test-model" }] });
    faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall("ask_sensei", { question: "PO direct question?" }),
      ], { stopReason: "toolUse" }),
      fauxAssistantMessage("thanks"),
      fauxAssistantMessage([
        fauxToolCall("task_finished", {}),
      ], { stopReason: "toolUse" }),
    ]);
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(provider, "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const asks: any[] = [];

    try {
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "po-ask-sensei",
        body: "Immediately ask Sensei a direct question, then finish.",
        activeSessions: new Map() as any,
        pi: { __unfoldingAskSensei: async (params: any) => {
          asks.push(params);
          return "Because";
        } } as any,
        postOutput: () => {},
        nestedDelegateToolFactory,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      assert.equal(result.outcome, "finished");
      assert.deepEqual(asks, [{ question: "PO direct question?" }]);
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("PO session uses the tool allowlist declared in roles/po.md", async () => {
    const { cwd } = makeTestGitRepo("session-factory");
    const { faux, authStorage, modelRegistry } = fauxSessionSetup("session-po-tools");
    try {
      const activeSessions = new Map() as any;
      const { session } = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "po-tool-allowlist",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions,
        pi: {} as any,
        postOutput: () => {},
        nestedDelegateToolFactory,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      const tools = session.getAllTools().map((t: any) => t.name);
      assert.equal(tools.includes("bash"), false, "PO session must not expose bash");
      assert.equal(tools.includes("read"), true, "PO session must expose read");
      assert.equal(tools.includes("write"), true, "PO session must expose write");
      assert.equal(tools.includes("edit"), true, "PO session must expose edit");
      assert.equal(tools.includes("ask_sensei"), true, "PO session must expose ask_sensei");
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("source contains nestedDelegateToolFactory seam", () => {
    const src = readFileSync(new URL("../session-factory.ts", import.meta.url).pathname, "utf8");
    assert.ok(src.includes("nestedDelegateToolFactory"));
  });

  it("session-common fires session_start via bindExtensions and shutdown emits session_shutdown", () => {
    const common = readFileSync(new URL("../session-common.ts", import.meta.url).pathname, "utf8");
    assert.ok(common.includes("bindExtensions({})"), "createChildAgentSession must call bindExtensions");
    assert.ok(common.includes("session_shutdown"), "shutdown helper must emit session_shutdown");
  });

  it("session-factory calls shutdown in finally", () => {
    const src = readFileSync(new URL("../session-factory.ts", import.meta.url).pathname, "utf8");
    assert.ok(src.includes("shutdown()"), "startChildSession must call shutdown() in finally");
  });

  it("session-restore returns shutdown alongside session", () => {
    const src = readFileSync(new URL("../session-restore.ts", import.meta.url).pathname, "utf8");
    assert.ok(src.includes("shutdown"), "restoreChildSession must return shutdown");
  });

  it("task-resume calls shutdown in finally when session was restored", () => {
    const src = readFileSync(new URL("../task-resume.ts", import.meta.url).pathname, "utf8");
    assert.ok(src.includes("shutdown?.()"), "resumeDelegatedTask must call shutdown?.() in finally");
  });
});
