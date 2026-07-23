import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {join, resolve} from "node:path";
import {ModelRegistry, ModelRuntime} from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {readTaskSnapshot, startChildSession} from "../session-factory.ts";
import { CHILD_SESSION_FAILURE_BLOCKED_REASON, MISSING_CHECKPOINT_BLOCKED_REASON } from "../task-delegate.ts";
import {restoreChildSession} from "../session-restore.ts";
import {cleanupTestTempDir, makeTestTempDir} from "./test-temp.ts";
import {makeTestGitRepo} from "./test-git-repo.ts";
import {expectLastToolResult, fauxAssistantMessage, fauxToolCall, registerFauxModelsInRegistry, registerFauxProvider} from "./faux-provider.ts";

function nestedDelegateToolFactory(_shortRole: string, _currentCommissionerSlug: string) {
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

async function fauxSetup(name: string, responses: any[]) {
  const provider = `${name}-${Date.now()}`;
  const faux = registerFauxProvider({
    provider,
    models: [{id: "test-model"}],
  });
  faux.setResponses(responses);
  const credentials = new InMemoryCredentialStore();
  const modelRuntime = await ModelRuntime.create({ credentials });
  await modelRuntime.setRuntimeApiKey(provider, "test-key");
  const modelRegistry = new ModelRegistry(modelRuntime);
  registerFauxModelsInRegistry(modelRegistry, faux);
  return {faux, modelRegistry};
}

function blockedTaskFauxResponses() {
  return [
    fauxAssistantMessage([
      fauxToolCall("task_block", {blocked_reason: "need input"}),
    ], {stopReason: "toolUse"}),
    fauxAssistantMessage("blocked"),
  ];
}

async function fauxSessionSetup(name: string) {
  return fauxSetup(name, blockedTaskFauxResponses());
}

function createDelayedQuarkusProbeExtension(cwd: string, name: string): string {
  const fakeExtensionDir = join(cwd, ".test-ext", name);
  mkdirSync(fakeExtensionDir, {recursive: true});
  writeFileSync(join(fakeExtensionDir, "package.json"), JSON.stringify({
    name: `pi-${name}`,
    type: "module",
    pi: {extensions: ["."]},
  }, null, 2));
  writeFileSync(join(fakeExtensionDir, "index.ts"), `
export default function (pi) {
  pi.on("session_start", async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    pi.registerTool({
      name: "quarkus_delayed_probe",
      label: "delayed probe",
      description: "Test-only tool registered asynchronously during session_start.",
      parameters: { type: "object", properties: {} },
      async execute() {
        return {
          content: [{ type: "text", text: "delayed probe ready" }],
          details: {},
        };
      },
    });
  });
}
`);
  return fakeExtensionDir;
}

describe("startChildSession groundwork", () => {
  it("automatically recreates a child session when task_block requests recreation", async () => {
    const {cwd} = makeTestGitRepo("session-factory");
    const provider = `session-recreate-${Date.now()}`;
    const faux = registerFauxProvider({
      provider,
      models: [{id: "test-model"}],
    });
    faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall("task_block", { recreate: { resume_message: "bootstrap done; continue with Quarkus tools" } }),
      ], {stopReason: "toolUse"}),
      fauxAssistantMessage([
        fauxToolCall("task_finished", {}),
      ], {stopReason: "toolUse"}),
    ]);
    const credentials = new InMemoryCredentialStore();
      const modelRuntime = await ModelRuntime.create({ credentials });
  await modelRuntime.setRuntimeApiKey(provider, "test-key");
  const modelRegistry = new ModelRegistry(modelRuntime);
  registerFauxModelsInRegistry(modelRegistry, faux);
    try {
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "recreate-child",
        body: "First bootstrap, then continue.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {},
        nestedDelegateToolFactory,
        model: faux.getModel(),
                modelRegistry,
      });
      assert.equal(result.outcome, "finished");
      assert.equal(readTaskSnapshot(cwd, "recreate-child")?.status, "finished");
      assert.equal(readTaskSnapshot(cwd, "recreate-child")?.recreate_message, undefined);
      assert.equal(faux.state.callCount, 2);
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("creates a task with session_file and base_sha persisted", async () => {
    const {cwd, head} = makeTestGitRepo("session-factory");
    const {faux, modelRegistry} = await fauxSetup("session-factory", blockedTaskFauxResponses());
    try {
      const resultPromise = startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "coder-task",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {
        },
        nestedDelegateToolFactory,
        model: faux.getModel(),
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
    const {faux, modelRegistry} = await fauxSessionSetup("session-init-git");
    try {
      mkdirSync(join(cwd, "docs"), {recursive: true});
      writeFileSync(join(cwd, "docs", "README.md"), "seed\n");

      const output: string[] = [];
      const resultPromise = startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "coder-init-git",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: (line: string) => {
          output.push(line);
        },
        nestedDelegateToolFactory,
        model: faux.getModel(),
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
    const {faux, modelRegistry} = await fauxSessionSetup("session-clean");
    try {
      const resultPromise = startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "coder-clean",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {
        },
        nestedDelegateToolFactory,
        model: faux.getModel(),
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
    const {faux, modelRegistry} = await fauxSessionSetup("session-snapshot");
    try {
      writeFileSync(join(cwd, "docs", "README.md"), "seed\nchanged before delegate\n");
      writeFileSync(join(cwd, "notes.txt"), "untracked before delegate\n");

      const resultPromise = startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "coder-snapshot",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {
        },
        nestedDelegateToolFactory,
        model: faux.getModel(),
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
    const credentials = new InMemoryCredentialStore();
      const modelRuntime = await ModelRuntime.create({ credentials });
  await modelRuntime.setRuntimeApiKey(provider, "test-key");
  const modelRegistry = new ModelRegistry(modelRuntime);
  registerFauxModelsInRegistry(modelRegistry, faux);
    try {
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "coder-tooluse",
        body: "Write docs/product.md, then call task_finished.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {
        },
        nestedDelegateToolFactory,
        model: faux.getModel(),
                modelRegistry,
      });

      assert.equal(result.outcome, "finished");
      assert.equal(faux.state.callCount, 2, "task_finished now terminates immediately, so the follow-up toolUse response is reached without an extra filler turn");
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
    const credentials = new InMemoryCredentialStore();
      const modelRuntime = await ModelRuntime.create({ credentials });
  await modelRuntime.setRuntimeApiKey(provider, "test-key");
  const modelRegistry = new ModelRegistry(modelRuntime);
  registerFauxModelsInRegistry(modelRegistry, faux);
    try {
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "coder-missing-checkpoint",
        body: "Do work.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {
        },
        nestedDelegateToolFactory,
        model: faux.getModel(),
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
    const credentials = new InMemoryCredentialStore();
      const modelRuntime = await ModelRuntime.create({ credentials });
  await modelRuntime.setRuntimeApiKey(provider, "test-key");
  const modelRegistry = new ModelRegistry(modelRuntime);
  registerFauxModelsInRegistry(modelRegistry, faux);
    try {
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "coder-missing-checkpoint-block",
        body: "Do work.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {
        },
        nestedDelegateToolFactory,
        model: faux.getModel(),
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
    const credentials = new InMemoryCredentialStore();
      const modelRuntime = await ModelRuntime.create({ credentials });
  await modelRuntime.setRuntimeApiKey(provider, "test-key");
  const modelRegistry = new ModelRegistry(modelRuntime);
  registerFauxModelsInRegistry(modelRegistry, faux);
    try {
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "coder-child-failure",
        body: "Do work.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {
        },
        nestedDelegateToolFactory,
        model: faux.getModel(),
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
    const credentials = new InMemoryCredentialStore();
      const modelRuntime = await ModelRuntime.create({ credentials });
  await modelRuntime.setRuntimeApiKey(provider, "test-key");
  const modelRegistry = new ModelRegistry(modelRuntime);
  registerFauxModelsInRegistry(modelRegistry, faux);
    try {
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "coder-child-aborted",
        body: "Do work.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {
        },
        nestedDelegateToolFactory,
        model: faux.getModel(),
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
    const credentials = new InMemoryCredentialStore();
      const modelRuntime = await ModelRuntime.create({ credentials });
  await modelRuntime.setRuntimeApiKey(provider, "test-key");
  const modelRegistry = new ModelRegistry(modelRuntime);
  registerFauxModelsInRegistry(modelRegistry, faux);
    try {
      const controller = new AbortController();
      queueMicrotask(() => controller.abort());

      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "coder-local-abort",
        body: "Do work.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {
        },
        signal: controller.signal,
        nestedDelegateToolFactory,
        model: faux.getModel(),
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
    const credentials = new InMemoryCredentialStore();
      const modelRuntime = await ModelRuntime.create({ credentials });
  await modelRuntime.setRuntimeApiKey(provider, "test-key");
  const modelRegistry = new ModelRegistry(modelRuntime);
  registerFauxModelsInRegistry(modelRegistry, faux);
    try {
      const controller = new AbortController();
      queueMicrotask(() => controller.abort());

      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "coder-local-abort-terminal",
        body: "Do work.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {
        },
        signal: controller.signal,
        nestedDelegateToolFactory,
        model: faux.getModel(),
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
    const credentials = new InMemoryCredentialStore();
      const modelRuntime = await ModelRuntime.create({ credentials });
  await modelRuntime.setRuntimeApiKey(provider, "test-key");
  const modelRegistry = new ModelRegistry(modelRuntime);
  registerFauxModelsInRegistry(modelRegistry, faux);
    try {
      const controller = new AbortController();
      queueMicrotask(() => controller.abort());

      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "coder-parent-signal-abort",
        body: "Do work.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {
        },
        parentSignal: controller.signal,
        nestedDelegateToolFactory,
        model: faux.getModel(),
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
    const credentials = new InMemoryCredentialStore();
      const modelRuntime = await ModelRuntime.create({ credentials });
  await modelRuntime.setRuntimeApiKey(provider, "test-key");
  const modelRegistry = new ModelRegistry(modelRuntime);
  registerFauxModelsInRegistry(modelRegistry, faux);
    try {
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "coder-truncation",
        body: "Do work.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {
        },
        nestedDelegateToolFactory,
        model: faux.getModel(),
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
    const {faux, modelRegistry} = await fauxSessionSetup("session-restore");
    let restoredShutdown: (() => Promise<void>) | undefined;
    try {
      const activeSessions = new Map() as any;
      const {session, outcome} = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "coder-restore",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions,
        pi: {} as any,
        postOutput: () => {
        },
        nestedDelegateToolFactory,
        model: faux.getModel(),
                modelRegistry,
      });

      assert.equal(outcome, "blocked");
      const snapshot = readTaskSnapshot(cwd, "coder-restore");
      assert.ok(snapshot?.session_file, "task should persist session_file");

      activeSessions.delete("coder-restore");
      const restored = await restoreChildSession(cwd, "coder-restore", activeSessions, {} as any, () => {
      }, nestedDelegateToolFactory);
      assert.ok(restored, "restoreChildSession should restore a real persisted child session");
      restoredShutdown = restored?.shutdown;
      assert.equal(restored?.session.sessionFile, snapshot?.session_file);
      assert.equal(restored?.session.sessionManager.getSessionFile(), snapshot?.session_file);
      assert.equal(session.sessionFile, snapshot?.session_file);
    } finally {
      await restoredShutdown?.();
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("child sessions exclude root-only task tools, keep ask_sensei, and load sibling pi extensions", async () => {
    const { cwd } = makeTestGitRepo("session-factory");
    const { faux, modelRegistry } = await fauxSessionSetup("session-tools");
    try {
      const activeSessions = new Map() as any;
      const { session } = await startChildSession({
        cwd,
        from: "po",
        role: "architect",
        slug: "architect-tools",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions,
        pi: {
          __unfoldingRootUi: { hasUI: true, mode: "rpc", ui: { async input() { return "5"; } } },
          __unfoldingExtensionPaths: [
            resolve(new URL("../../maven", import.meta.url).pathname),
            resolve(new URL("../../idea", import.meta.url).pathname),
          ],
        } as any,
        postOutput: () => {},
        nestedDelegateToolFactory,
        model: faux.getModel(),
                modelRegistry,
      });

      const tools = (session.agent.state.tools ?? []).map((t: any) => t.name);
      assert.equal(tools.includes("task_list"), false, "child session must not expose task_list");
      assert.equal(tools.includes("task_read"), false, "child session must not expose task_read");
      assert.equal(tools.includes("task_continue"), true, "child session should expose task_continue");
      assert.equal(tools.includes("ask_sensei"), true, "child session should expose the proxied ask_sensei");
      assert.equal(tools.includes("maven_run"), true, "architect allowlist includes maven_run from sibling extension");
      assert.equal(tools.includes("maven_project_info"), true, "architect allowlist maven_* includes maven_project_info");
      assert.equal(tools.includes("maven_lookup_version"), true, "architect allowlist maven_* includes maven_lookup_version");
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("child sessions also load bundled sibling extensions even when inherited extension paths were not captured", async () => {
    const { cwd } = makeTestGitRepo("session-factory");
    const { faux, modelRegistry } = await fauxSessionSetup("session-tools-fallback");
    try {
      const activeSessions = new Map() as any;
      const { session } = await startChildSession({
        cwd,
        from: "po",
        role: "architect",
        slug: "architect-tools-fallback",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions,
        pi: {
          __unfoldingRootUi: { hasUI: true, mode: "rpc", ui: { async input() { return "5"; } } },
        } as any,
        postOutput: () => {},
        nestedDelegateToolFactory,
        model: faux.getModel(),
                modelRegistry,
      });

      const tools = (session.agent.state.tools ?? []).map((t: any) => t.name);
      assert.equal(tools.includes("quarkus_bootstrap"), true, "architect should still get quarkus_bootstrap from bundled sibling extension fallback");
      assert.equal(tools.includes("maven_run"), true, "architect should still get maven tools from bundled sibling extension fallback");
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("child sessions hide quarkus_bootstrap once the workspace is already a Quarkus project", async () => {
    const { cwd } = makeTestGitRepo("session-factory");
    writeFileSync(join(cwd, "pom.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <build>
    <plugins>
      <plugin>
        <groupId>io.quarkus</groupId>
        <artifactId>quarkus-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
`);
    const { faux, modelRegistry } = await fauxSessionSetup("session-tools-hide-bootstrap");
    try {
      const activeSessions = new Map() as any;
      const { session } = await startChildSession({
        cwd,
        from: "po",
        role: "architect",
        slug: "architect-tools-hide-bootstrap",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions,
        pi: {
          __unfoldingRootUi: { hasUI: true, mode: "rpc", ui: { async input() { return "5"; } } },
        } as any,
        postOutput: () => {},
        nestedDelegateToolFactory,
        model: faux.getModel(),
                modelRegistry,
      });

      const tools = (session.agent.state.tools ?? []).map((t: any) => t.name);
      assert.equal(tools.includes("quarkus_bootstrap"), false, "quarkus_bootstrap should disappear once pom.xml already activates Quarkus tooling");
      assert.equal(tools.includes("maven_run"), true, "other architect tools should stay available");
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("fresh architect child sessions can call quarkus tools registered asynchronously during session_start", async () => {
    const {cwd} = makeTestGitRepo("session-factory");
    const delayedExtension = createDelayedQuarkusProbeExtension(cwd, "fake-delayed-quarkus-probe");
    const {faux, modelRegistry} = await fauxSetup("session-fresh-delayed-quarkus-probe", [
      fauxAssistantMessage([
        fauxToolCall("quarkus_delayed_probe", {}),
      ], {stopReason: "toolUse"}),
      expectLastToolResult({
        toolName: "quarkus_delayed_probe",
        isError: false,
        textIncludes: ["delayed probe ready"],
      }, fauxAssistantMessage([
        fauxToolCall("task_finished", {}),
      ], {stopReason: "toolUse"})),
    ]);
    try {
      const result = await startChildSession({
        cwd,
        from: "po",
        role: "architect",
        slug: "architect-fresh-delayed-quarkus-probe",
        body: "Call quarkus_delayed_probe, then finish.",
        activeSessions: new Map() as any,
        pi: {
          __unfoldingExtensionPaths: [delayedExtension],
        } as any,
        postOutput: () => {},
        nestedDelegateToolFactory,
        model: faux.getModel(),
                modelRegistry,
      });

      assert.equal(result.outcome, "finished");
      assert.equal(faux.state.callCount, 2);
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
    const credentials = new InMemoryCredentialStore();
      const modelRuntime = await ModelRuntime.create({ credentials });
  await modelRuntime.setRuntimeApiKey(provider, "test-key");
  const modelRegistry = new ModelRegistry(modelRuntime);
  registerFauxModelsInRegistry(modelRegistry, faux);
    const asks: any[] = [];

    try {
      const result = await startChildSession({
        cwd,
        from: "po",
        role: "architect",
        slug: "architect-ask-sensei",
        body: "Immediately ask Sensei a direct question, then finish.",
        activeSessions: new Map() as any,
        pi: { __unfoldingRootUi: {
          hasUI: true,
          mode: "rpc",
          ui: {
            async select(prompt: string, options: string[]) {
              asks.push({ prompt, options });
              return "B";
            },
            async editor(prompt: string, prefill: string) {
              asks.push({ prompt, prefill });
              return "B";
            },
          },
        } } as any,
        postOutput: () => {},
        nestedDelegateToolFactory,
        model: faux.getModel(),
                modelRegistry,
      });

      assert.equal(result.outcome, "finished");
      assert.deepEqual(asks, [
        { prompt: "[architect]\n\nArchitect direct question?", options: ["A", "B"] },
        { prompt: "[architect]\n\nArchitect direct question?", prefill: "B" },
      ]);
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
    const credentials = new InMemoryCredentialStore();
      const modelRuntime = await ModelRuntime.create({ credentials });
  await modelRuntime.setRuntimeApiKey(provider, "test-key");
  const modelRegistry = new ModelRegistry(modelRuntime);
  registerFauxModelsInRegistry(modelRegistry, faux);
    const asks: any[] = [];

    try {
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "po-ask-sensei",
        body: "Immediately ask Sensei a direct question, then finish.",
        activeSessions: new Map() as any,
        pi: { __unfoldingRootUi: {
          hasUI: true,
          mode: "rpc",
          ui: {
            async input(prompt: string) {
              asks.push(prompt);
              return "Because";
            },
          },
        } } as any,
        postOutput: () => {},
        nestedDelegateToolFactory,
        model: faux.getModel(),
                modelRegistry,
      });

      assert.equal(result.outcome, "finished");
      assert.deepEqual(asks, ["[po]\n\nPO direct question?"]);
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("PO session uses the tool allowlist declared in roles/po.md", async () => {
    const { cwd } = makeTestGitRepo("session-factory");
    const { faux, modelRegistry } = await fauxSessionSetup("session-po-tools");
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
                modelRegistry,
      });

      const tools = (session.agent.state.tools ?? []).map((t: any) => t.name);
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

  it("onUpdate receives each transcript line exactly once — no duplicate final flush", async () => {
    const {cwd} = makeTestGitRepo("session-factory");
    const provider = `session-no-duplicate-flush-${Date.now()}`;
    const faux = registerFauxProvider({provider, models: [{id: "test-model"}]});
    faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall("task_finished", {}),
      ], {stopReason: "toolUse"}),
      fauxAssistantMessage("done"),
    ]);
    const credentials = new InMemoryCredentialStore();
      const modelRuntime = await ModelRuntime.create({ credentials });
  await modelRuntime.setRuntimeApiKey(provider, "test-key");
  const modelRegistry = new ModelRegistry(modelRuntime);
  registerFauxModelsInRegistry(modelRegistry, faux);
    const onUpdateCalls: string[] = [];
    try {
      await startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "coder-no-dup-flush",
        body: "Call task_finished.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {},
        nestedDelegateToolFactory,
        onUpdate: (u: any) => onUpdateCalls.push(u.content[0].text),
        model: faux.getModel(),
                modelRegistry,
      });

      // Every onUpdate payload containing the finished checkpoint row
      // should appear exactly once — not duplicated by the terminal flush.
      const withCheckpoint = onUpdateCalls.filter(t => t.includes("task_finished") && t.includes("✓"));
      assert.equal(
        withCheckpoint.length, 1,
        `expected task_finished ✓ in exactly one onUpdate call, got ${withCheckpoint.length}\nonUpdateCalls:\n${onUpdateCalls.map((t, i) => `[${i}]: ${t}`).join("\n---\n")}`,
      );
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("source contains nestedDelegateToolFactory seam", () => {
    const src = readFileSync(new URL("../session-factory.ts", import.meta.url).pathname, "utf8");
    assert.ok(src.includes("nestedDelegateToolFactory"));
  });

  it("session-common binds extensions headless first, then swaps in proxied child UI, and shutdown emits session_shutdown", () => {
    const common = readFileSync(new URL("../session-common.ts", import.meta.url).pathname, "utf8");
    assert.ok(common.includes("bindExtensions({})"), "createChildAgentSession must call bindExtensions headless first");
    assert.ok(common.includes("createChildUiContext"), "createChildAgentSession must install proxied child UI after startup");
    assert.ok(common.includes('setUIContext(createChildUiContext(pi, shortRole, childUiBus, theme), "tui")'), "child UI must be swapped in via runner.setUIContext after bindExtensions");
    assert.ok(common.includes("session_shutdown"), "shutdown helper must emit session_shutdown");
  });

  it("session-factory calls shutdown in finally and wires child UI bus into the stream", () => {
    const src = readFileSync(new URL("../session-factory.ts", import.meta.url).pathname, "utf8");
    assert.ok(src.includes("shutdown()"), "startChildSession must call shutdown() in finally");
    assert.ok(src.includes("createChildUiBus()"), "startChildSession must create a shared child UI bus");
    assert.ok(src.includes("subscribeUiEvents"), "startChildSession must forward child UI events into streamChildSession");
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
