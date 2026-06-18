import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "./faux-provider.ts";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { createTask, readTask } from "../task-store.ts";
import { taskBlock, taskFinished, taskReopen, taskUnblock } from "../task-tools.ts";
import { resumeDelegatedTask } from "../task-resume.ts";
import { MISSING_CHECKPOINT_BLOCKED_REASON } from "../task-delegate.ts";
import { restoreChildSession } from "../session-restore.ts";
import { startChildSession } from "../session-factory.ts";
import { makeTestTempDir, cleanupTestTempDir } from "./test-temp.ts";
import { makeTestGitRepo } from "./test-git-repo.ts";

function nestedDelegateToolFactory(_shortRole: string) {
  return {
    name: "task_delegate",
    label: "Task delegate",
    description: "stub",
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content: [{ type: "text", text: "stub" }], details: {} };
    },
  };
}

function fakeSessions() {
  return new Map();
}

describe("restoreChildSession", () => {
  it("returns null when session_file is missing", async () => {
    const cwd = makeTestTempDir("resume-task");
    try {
      createTask(cwd, { slug: "arch-add-todo", from: "po", to: "architect", body: "Continue" });
      const result = await restoreChildSession(cwd, "arch-add-todo", new Map() as any, {} as any, () => {}, nestedDelegateToolFactory);
      assert.equal(result, null);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("returns null when session_file does not exist", async () => {
    const cwd = makeTestTempDir("resume-task");
    try {
      createTask(cwd, { slug: "arch-add-todo", from: "po", to: "architect", body: "Continue", session_file: join(cwd, "missing.jsonl") });
      const result = await restoreChildSession(cwd, "arch-add-todo", new Map() as any, {} as any, () => {}, nestedDelegateToolFactory);
      assert.equal(result, null);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("restores a session when session_file exists", async () => {
    const cwd = makeTestTempDir("resume-task");
    try {
      const sessionFile = join(cwd, "session.jsonl");
      writeFileSync(sessionFile, JSON.stringify({ version: 1, cwd }) + "\n");
      createTask(cwd, { slug: "arch-add-todo", from: "po", to: "architect", body: "Continue", session_file: sessionFile });
      const result = await restoreChildSession(cwd, "arch-add-todo", new Map() as any, {} as any, () => {}, nestedDelegateToolFactory);
      assert.ok(result !== null);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});

describe("resumeDelegatedTask restore and fallback behavior", () => {
  it("task_unblock throws when no live session and no restore is possible", async () => {
    const cwd = makeTestTempDir("resume-task");
    const output: string[] = [];
    try {
      createTask(cwd, { slug: "arch-add-todo", from: "po", to: "architect", body: "Continue" });
      taskBlock(cwd, "arch-add-todo", "waiting for ADR decision");

      await assert.rejects(
        () => resumeDelegatedTask({
          action: "unblock",
          cwd,
          slug: "arch-add-todo",
          reason: "ADR approved",
          activeSessions: fakeSessions() as any,
          postOutput: (line) => output.push(line),
          mutateTask: taskUnblock,
          pi: {} as any,
        }),
        /task_unblock: no live session found for slug "arch-add-todo", and the session could not be restored/,
      );

      assert.deepEqual(output, [
        '  ⚠ task_unblock: no live session found for slug "arch-add-todo", and the session could not be restored. This is likely a bug in the unfolding extension — if you don\'t fully understand the cause, print out the current situation and stop working.',
      ]);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("task_reopen throws when no live session and no restore is possible", async () => {
    const cwd = makeTestTempDir("resume-task");
    const output: string[] = [];
    try {
      createTask(cwd, { slug: "arch-add-todo", from: "po", to: "architect", body: "Continue" });
      taskFinished(cwd, "arch-add-todo");

      await assert.rejects(
        () => resumeDelegatedTask({
          action: "reopen",
          cwd,
          slug: "arch-add-todo",
          reason: "please revise the ADR",
          activeSessions: fakeSessions() as any,
          postOutput: (line) => output.push(line),
          mutateTask: taskReopen,
          pi: {} as any,
        }),
        /task_reopen: no live session found for slug "arch-add-todo", and the session could not be restored/,
      );

      assert.deepEqual(output, [
        '  ⚠ task_reopen: no live session found for slug "arch-add-todo", and the session could not be restored. This is likely a bug in the unfolding extension — if you don\'t fully understand the cause, print out the current situation and stop working.',
      ]);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("task_unblock restores a blocked child session and reaches the next checkpoint with a faux model", async () => {
    const { cwd } = makeTestGitRepo("resume-task");
    const provider = `resume-task-${Date.now()}`;
    const faux = registerFauxProvider({
      provider,
      models: [{ id: "test-model" }],
    });
    faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall("task_block", { blocked_reason: "need input" }),
      ], { stopReason: "toolUse" }),
      fauxAssistantMessage("ok"),
      fauxAssistantMessage([
        fauxToolCall("task_finished", {}),
      ], { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(provider, "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);

    try {
      const activeSessions = new Map() as any;
      const started = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-resume",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions,
        pi: {} as any,
        postOutput: () => {},
        nestedDelegateToolFactory,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      assert.equal(started.outcome, "blocked");
      activeSessions.delete("coder-resume");

      const outcome = await resumeDelegatedTask({
        action: "unblock",
        cwd,
        slug: "coder-resume",
        reason: "continue",
        activeSessions,
        postOutput: () => {},
        mutateTask: taskUnblock,
        pi: {} as any,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      assert.equal(outcome, "finished");
      const task = readTask(cwd, "coder-resume");
      assert.ok(task?.status === "finished", `unexpected status: ${task?.status}`);
      assert.equal(faux.state.callCount, 4);
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("task_unblock prompts once after a missing checkpoint and succeeds when the child then calls task_finished", async () => {
    const { cwd } = makeTestGitRepo("resume-task");
    const provider = `resume-missing-checkpoint-${Date.now()}`;
    const faux = registerFauxProvider({
      provider,
      models: [{ id: "test-model" }],
    });
    faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall("task_block", { blocked_reason: "need input" }),
      ], { stopReason: "toolUse" }),
      fauxAssistantMessage("ok"),
      fauxAssistantMessage("I finished but forgot the checkpoint"),
      fauxAssistantMessage([
        fauxToolCall("task_finished", {}),
      ], { stopReason: "toolUse" }),
    ]);
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(provider, "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);

    try {
      const activeSessions = new Map() as any;
      const started = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-resume-missing-checkpoint",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions,
        pi: {} as any,
        postOutput: () => {},
        nestedDelegateToolFactory,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      assert.equal(started.outcome, "blocked");
      activeSessions.delete("coder-resume-missing-checkpoint");

      const outcome = await resumeDelegatedTask({
        action: "unblock",
        cwd,
        slug: "coder-resume-missing-checkpoint",
        reason: "continue",
        activeSessions,
        postOutput: () => {},
        mutateTask: taskUnblock,
        pi: {} as any,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      assert.equal(outcome, "finished");
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("task_unblock blocks after repeated missing checkpoints during the resumed run", async () => {
    const { cwd } = makeTestGitRepo("resume-task");
    const provider = `resume-missing-checkpoint-block-${Date.now()}`;
    const faux = registerFauxProvider({
      provider,
      models: [{ id: "test-model" }],
    });
    faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall("task_block", { blocked_reason: "need input" }),
      ], { stopReason: "toolUse" }),
      fauxAssistantMessage("ok"),
      fauxAssistantMessage("forgot checkpoint once"),
      fauxAssistantMessage("forgot checkpoint twice"),
    ]);
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(provider, "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);

    try {
      const activeSessions = new Map() as any;
      const started = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-resume-missing-checkpoint-block",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions,
        pi: {} as any,
        postOutput: () => {},
        nestedDelegateToolFactory,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      assert.equal(started.outcome, "blocked");
      activeSessions.delete("coder-resume-missing-checkpoint-block");

      const outcome = await resumeDelegatedTask({
        action: "unblock",
        cwd,
        slug: "coder-resume-missing-checkpoint-block",
        reason: "continue",
        activeSessions,
        postOutput: () => {},
        mutateTask: taskUnblock,
        pi: {} as any,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      assert.equal(outcome, "blocked");
      const task = readTask(cwd, "coder-resume-missing-checkpoint-block");
      assert.equal(task?.blocked_reason, MISSING_CHECKPOINT_BLOCKED_REASON);
      assert.equal(faux.state.callCount, 4, "should retry exactly once during resumed run after the first missing checkpoint");
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("task_unblock blocks after repeated truncation during the resumed run", async () => {
    const { cwd } = makeTestGitRepo("resume-task");
    const provider = `resume-truncation-${Date.now()}`;
    const faux = registerFauxProvider({
      provider,
      models: [{ id: "test-model" }],
    });
    faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall("task_block", { blocked_reason: "need input" }),
      ], { stopReason: "toolUse" }),
      fauxAssistantMessage("ok"),
      fauxAssistantMessage("first resumed truncation", { stopReason: "length" }),
      fauxAssistantMessage("second resumed truncation", { stopReason: "length" }),
    ]);
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(provider, "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);

    try {
      const activeSessions = new Map() as any;
      const started = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-resume-truncation",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions,
        pi: {} as any,
        postOutput: () => {},
        nestedDelegateToolFactory,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      assert.equal(started.outcome, "blocked");
      activeSessions.delete("coder-resume-truncation");

      const outcome = await resumeDelegatedTask({
        action: "unblock",
        cwd,
        slug: "coder-resume-truncation",
        reason: "continue",
        activeSessions,
        postOutput: () => {},
        mutateTask: taskUnblock,
        pi: {} as any,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      assert.equal(outcome, "blocked");
      const task = readTask(cwd, "coder-resume-truncation");
      assert.equal(
        task?.blocked_reason,
        "Automatic recovery failed after repeated truncation before the child reached a checkpoint.",
      );
      assert.equal(faux.state.callCount, 4, "should retry exactly once during resumed run");
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("task_reopen blocks after repeated truncation during the resumed run", async () => {
    const { cwd } = makeTestGitRepo("resume-task");
    const provider = `resume-reopen-truncation-${Date.now()}`;
    const faux = registerFauxProvider({
      provider,
      models: [{ id: "test-model" }],
    });
    faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall("task_finished", {}),
      ], { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
      fauxAssistantMessage("first reopened truncation", { stopReason: "length" }),
      fauxAssistantMessage("second reopened truncation", { stopReason: "length" }),
    ]);
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(provider, "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);

    try {
      const activeSessions = new Map() as any;
      const started = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-reopen-truncation",
        body: "Call task_finished. Just call the tool, nothing else.",
        activeSessions,
        pi: {} as any,
        postOutput: () => {},
        nestedDelegateToolFactory,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      assert.equal(started.outcome, "finished");
      activeSessions.delete("coder-reopen-truncation");

      const outcome = await resumeDelegatedTask({
        action: "reopen",
        cwd,
        slug: "coder-reopen-truncation",
        reason: "continue",
        activeSessions,
        postOutput: () => {},
        mutateTask: taskReopen,
        pi: {} as any,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
      });

      assert.equal(outcome, "blocked");
      const task = readTask(cwd, "coder-reopen-truncation");
      assert.equal(
        task?.blocked_reason,
        "Automatic recovery failed after repeated truncation before the child reached a checkpoint.",
      );
      assert.equal(faux.state.callCount, 4, "should retry exactly once during reopened run");
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });
});
