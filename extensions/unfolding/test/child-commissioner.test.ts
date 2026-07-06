/**
 * Tests that child sessions (e.g. PO) have access to all commissioner tools
 * needed to manage their own grandchild sessions (e.g. Architect, Coder).
 */

import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "./faux-provider.ts";
import { startChildSession } from "../session-factory.ts";
import { makeTaskDelegateDefinition } from "../task-delegate-tool.ts";
import { makeTestGitRepo } from "./test-git-repo.ts";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTestTempDir } from "./test-temp.ts";

/**
 * Sets up a single faux provider shared by child and grandchild sessions.
 * Both sessions use ctx.model (the shared model), so all LLM calls go through
 * one queue in call order: grandchild calls are interleaved within child calls
 * at the point where task_delegate blocks waiting for the grandchild.
 */
function listExportFiles(cwd: string): string[] {
  const dir = join(cwd, ".pi", "unfolding", "exports");
  return existsSync(dir) ? readdirSync(dir) : [];
}

function sharedFauxSetup(name: string) {
  const provider = `${name}-${Date.now()}`;
  const faux = registerFauxProvider({ provider, models: [{ id: "test-model" }] });
  const auth = AuthStorage.inMemory();
  auth.setRuntimeApiKey(provider, "test-key");
  const modelRegistry = ModelRegistry.inMemory(auth);
  return { faux, auth, modelRegistry };
}

async function cleanupActiveSessions(activeSessions: Map<string, any>): Promise<void> {
  await Promise.all([...activeSessions.values()].map(async (session) => {
    if (typeof session?.abort === "function") {
      await session.abort().catch(() => {});
    }
    if (typeof session?.dispose === "function") {
      session.dispose();
    }
  }));
  activeSessions.clear();
}

const activeSessionMaps = new Set<Map<string, any>>();
const trackedSessions = new Set<any>();

function trackActiveSessions(): Map<string, any> {
  const activeSessions = new Map<string, any>();
  const originalSet = activeSessions.set.bind(activeSessions);
  activeSessions.set = ((key: string, value: any) => {
    trackedSessions.add(value);
    return originalSet(key, value);
  }) as typeof activeSessions.set;
  activeSessionMaps.add(activeSessions);
  return activeSessions;
}

afterEach(async () => {
  await Promise.all([...activeSessionMaps].map(cleanupActiveSessions));
  await Promise.all([...trackedSessions].map(async (session) => {
    if (typeof session?.abort === "function") {
      await session.abort().catch(() => {});
    }
    if (typeof session?.dispose === "function") {
      session.dispose();
    }
  }));
  activeSessionMaps.clear();
  trackedSessions.clear();
});

describe("child commissioner tools", () => {
  it("child can call task_accept on a finished grandchild", async () => {
    const { cwd } = makeTestGitRepo("child-commissioner");
    const { faux, auth, modelRegistry } = sharedFauxSetup("accept");
    try {
      // Call order: child:task_delegate → grandchild:task_finished → child:task_accept → child:task_finished
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("task_delegate", { role: "coder", slug: "gc-accept", body: "do something" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("task_finished", {})], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("task_accept",   { slug: "gc-accept" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("task_finished", {})], { stopReason: "toolUse" }),
      ]);

      const activeSessions = trackActiveSessions();
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "child-accept",
        body: "delegate to a coder, accept the result, then finish",
        activeSessions,
        pi: {} as any,
        postOutput: () => {},
        nestedDelegateToolFactory: (shortRole) =>
          makeTaskDelegateDefinition(shortRole, activeSessions, {} as any, () => {}),
        model: faux.getModel(),
        authStorage: auth,
        modelRegistry,
      });

      assert.equal(result.outcome, "finished");
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("child can call task_reopen on a finished grandchild, and accept it after grandchild finishes again", async () => {
    const { cwd } = makeTestGitRepo("child-commissioner");
    const { faux: childFaux, auth: childAuth, modelRegistry: childRegistry } = sharedFauxSetup("reopen-child");
    const { faux: gcFaux, auth: gcAuth, modelRegistry: gcRegistry } = sharedFauxSetup("reopen-gc");
    try {
      childFaux.setResponses([
        fauxAssistantMessage([fauxToolCall("task_delegate", { role: "coder", slug: "gc-reopen", body: "do something" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("task_reopen",   { slug: "gc-reopen", reason: "needs more work" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("task_accept",   { slug: "gc-reopen" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("task_finished", {})], { stopReason: "toolUse" }),
      ]);
      // grandchild finishes, then finishes again after reopen; each run needs one extra call after abort
      gcFaux.setResponses([
        fauxAssistantMessage([fauxToolCall("task_finished", {})], { stopReason: "toolUse" }),
        fauxAssistantMessage([], { stopReason: "endTurn" }),
        fauxAssistantMessage([fauxToolCall("task_finished", {})], { stopReason: "toolUse" }),
        fauxAssistantMessage([], { stopReason: "endTurn" }),
      ]);

      const activeSessions = trackActiveSessions();
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "child-reopen",
        body: "delegate, reopen, accept, finish",
        activeSessions,
        pi: {} as any,
        postOutput: () => {},
        nestedDelegateToolFactory: (shortRole) => ({
          ...makeTaskDelegateDefinition(shortRole, activeSessions, {} as any, () => {}),
          execute: async (_id: string, params: any, _signal: any, _onUpdate: any, _ctx: any) => {
            const { startChildSession: startGc } = await import("../session-factory.ts");
            const { session, outcome } = await startGc({
              cwd,
              from: shortRole,
              role: params.role,
              slug: params.slug,
              body: params.body,
              activeSessions,
              pi: {} as any,
              postOutput: () => {},
              nestedDelegateToolFactory: () => makeTaskDelegateDefinition("coder", activeSessions, {} as any, () => {}),
              model: gcFaux.getModel(),
              authStorage: gcAuth,
              modelRegistry: gcRegistry,
            });
            activeSessions.set(params.slug, session);
            return { content: [{ type: "text", text: `Outcome: ${outcome}` }], details: {} };
          },
        }),
        model: childFaux.getModel(),
        authStorage: childAuth,
        modelRegistry: childRegistry,
      });

      assert.equal(result.outcome, "finished");
    } finally {
      childFaux.unregister();
      gcFaux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("child can call task_unblock on a blocked grandchild, and accept it after grandchild finishes", async () => {
    const { cwd } = makeTestGitRepo("child-commissioner");
    const { faux: childFaux, auth: childAuth, modelRegistry: childRegistry } = sharedFauxSetup("unblock-child");
    const { faux: gcFaux, auth: gcAuth, modelRegistry: gcRegistry } = sharedFauxSetup("unblock-gc");
    try {
      childFaux.setResponses([
        fauxAssistantMessage([fauxToolCall("task_delegate", { role: "coder", slug: "gc-unblock", body: "do something" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("task_unblock",  { slug: "gc-unblock", reason: "dependency resolved" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("task_accept",   { slug: "gc-unblock" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("task_finished", {})], { stopReason: "toolUse" }),
      ]);
      gcFaux.setResponses([
        fauxAssistantMessage([fauxToolCall("task_block", { blocked_reason: "waiting for dependency" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([], { stopReason: "endTurn" }),
        fauxAssistantMessage([fauxToolCall("task_finished", {})], { stopReason: "toolUse" }),
        fauxAssistantMessage([], { stopReason: "endTurn" }),
      ]);

      const activeSessions = trackActiveSessions();
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "child-unblock",
        body: "delegate, unblock, accept, finish",
        activeSessions,
        pi: {} as any,
        postOutput: () => {},
        nestedDelegateToolFactory: (shortRole) => ({
          ...makeTaskDelegateDefinition(shortRole, activeSessions, {} as any, () => {}),
          execute: async (_id: string, params: any, _signal: any, _onUpdate: any, _ctx: any) => {
            const { startChildSession: startGc } = await import("../session-factory.ts");
            const { session, outcome } = await startGc({
              cwd,
              from: shortRole,
              role: params.role,
              slug: params.slug,
              body: params.body,
              activeSessions,
              pi: {} as any,
              postOutput: () => {},
              nestedDelegateToolFactory: () => makeTaskDelegateDefinition("coder", activeSessions, {} as any, () => {}),
              model: gcFaux.getModel(),
              authStorage: gcAuth,
              modelRegistry: gcRegistry,
            });
            activeSessions.set(params.slug, session);
            return { content: [{ type: "text", text: `Outcome: ${outcome}` }], details: {} };
          },
        }),
        model: childFaux.getModel(),
        authStorage: childAuth,
        modelRegistry: childRegistry,
      });

      assert.equal(result.outcome, "finished");
    } finally {
      childFaux.unregister();
      gcFaux.unregister();
      cleanupTestTempDir(cwd);
    }
  });
  it("child can call task_rollback on a finished grandchild without losing its own task", async () => {
    const { cwd } = makeTestGitRepo("child-commissioner");
    const { faux: childFaux, auth: childAuth, modelRegistry: childRegistry } = sharedFauxSetup("rollback-child");
    const { faux: gcFaux, auth: gcAuth, modelRegistry: gcRegistry } = sharedFauxSetup("rollback-gc");
    try {
      childFaux.setResponses([
        fauxAssistantMessage([fauxToolCall("task_delegate", { role: "coder", slug: "gc-rollback", body: "do something" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("task_rollback", { slug: "gc-rollback" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("task_finished", {})], { stopReason: "toolUse" }),
        fauxAssistantMessage([], { stopReason: "endTurn" }),
      ]);
      gcFaux.setResponses([
        fauxAssistantMessage([fauxToolCall("task_finished", {})], { stopReason: "toolUse" }),
        fauxAssistantMessage([], { stopReason: "endTurn" }),
      ]);

      const activeSessions = trackActiveSessions();
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "child-rollback",
        body: "delegate, rollback, finish",
        activeSessions,
        pi: {} as any,
        postOutput: () => {},
        signal: AbortSignal.timeout(3000),
        nestedDelegateToolFactory: (shortRole) => ({
          ...makeTaskDelegateDefinition(shortRole, activeSessions, {} as any, () => {}),
          execute: async (_id: string, params: any, _signal: any, _onUpdate: any, _ctx: any) => {
            const { startChildSession: startGc } = await import("../session-factory.ts");
            const { session, outcome } = await startGc({
              cwd,
              from: shortRole,
              role: params.role,
              slug: params.slug,
              body: params.body,
              activeSessions,
              pi: {} as any,
              postOutput: () => {},
              nestedDelegateToolFactory: () => makeTaskDelegateDefinition("coder", activeSessions, {} as any, () => {}),
              model: gcFaux.getModel(),
              authStorage: gcAuth,
              modelRegistry: gcRegistry,
            });
            activeSessions.set(params.slug, session);
            return { content: [{ type: "text", text: `Outcome: ${outcome}` }], details: {} };
          },
        }),
        model: childFaux.getModel(),
        authStorage: childAuth,
        modelRegistry: childRegistry,
      });

      assert.equal(result.outcome, "finished");
    } finally {
      childFaux.unregister();
      gcFaux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("child delegate result includes blocked_reason for blocked grandchild", async () => {
    const { cwd } = makeTestGitRepo("child-commissioner");
    const { faux, auth, modelRegistry } = sharedFauxSetup("blocked-reason");
    try {
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("task_delegate", { role: "coder", slug: "gc-blocked", body: "do something" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("task_block", { blocked_reason: "technical blocker" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("task_finished", {})], { stopReason: "toolUse" }),
      ]);

      const activeSessions = trackActiveSessions();
      const tool = makeTaskDelegateDefinition("po", activeSessions, {} as any, () => {});
      const result = await tool.execute(
        "1",
        { role: "coder", slug: "gc-blocked", body: "do something" },
        AbortSignal.timeout(3000),
        undefined,
        {
          cwd,
          model: faux.getModel(),
          authStorage: auth,
          modelRegistry,
          abort() {},
        },
      );

      assert.match(result.content[0].text, /Outcome: blocked/);
      assert.match(result.content[0].text, /blocked_reason: technical blocker/);
      assert.equal(result.details?.blocked_reason, "technical blocker");
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("child commissioner debug mode exports commissioner html on handover", async () => {
    const { cwd } = makeTestGitRepo("child-commissioner");
    const { faux, auth, modelRegistry } = sharedFauxSetup("child-debug-export");
    const commissionerSessionFile = join(cwd, "child-commissioner-session.jsonl");
    const pi = {
      __unfoldingDebugExportsEnabled: true,
    } as any;
    try {
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("task_delegate", { role: "coder", slug: "gc-debug", body: "do something" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("task_finished", {})], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("task_accept", { slug: "gc-debug" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("task_finished", {})], { stopReason: "toolUse" }),
      ]);
      writeFileSync(commissionerSessionFile, JSON.stringify({type: "session", version: 3, id: "sess-child-commissioner", timestamp: "2026-06-22T00:00:00.000Z", cwd}) + "\n");

      const activeSessions = trackActiveSessions();
      const result = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "child-debug-export",
        body: "delegate to a coder, accept the result, then finish",
        activeSessions,
        pi,
        postOutput: () => {},
        signal: AbortSignal.timeout(3000),
        nestedDelegateToolFactory: (shortRole) =>
          makeTaskDelegateDefinition(shortRole, activeSessions, pi, () => {}),
        model: faux.getModel(),
        authStorage: auth,
        modelRegistry,
      });

      assert.equal(result.outcome, "finished");
      assert.deepEqual(listExportFiles(cwd).filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-gc-debug\.commissioner\.html$/.test(name)).length, 1);
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("task_delegate preserves the existing ask_sensei callback when the delegating session has no UI", async () => {
    const { cwd } = makeTestGitRepo("child-commissioner");
    const { faux, auth, modelRegistry } = sharedFauxSetup("nested-ask-sensei");
    const asks: any[] = [];
    const pi = {
      __unfoldingAskSensei: async (params: any) => {
        asks.push(params);
        return "WORKS";
      },
    } as any;
    try {
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("ask_sensei", { question: "Nested question?" })], { stopReason: "toolUse" }),
        fauxAssistantMessage("thanks"),
        fauxAssistantMessage([fauxToolCall("task_finished", {})], { stopReason: "toolUse" }),
      ]);

      const activeSessions = trackActiveSessions();
      const tool = makeTaskDelegateDefinition("architect", activeSessions, pi, () => {});
      const result = await tool.execute(
        "1",
        {
          role: "coder",
          slug: "gc-ask-sensei",
          body: "Immediately call ask_sensei with the question 'Nested question?' and then call task_finished.",
        },
        AbortSignal.timeout(3000),
        undefined,
        {
          cwd,
          hasUI: false,
          ui: {},
          model: faux.getModel(),
          authStorage: auth,
          modelRegistry,
          abort() {},
        },
      );

      assert.match(result.content[0].text, /Outcome: finished/);
      assert.deepEqual(asks, [{ question: "Nested question?", role: "coder" }]);
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("child session should abort when its propagated signal aborts during nested delegation", async () => {
    const { cwd } = makeTestGitRepo("child-commissioner");
    const { faux: childFaux, auth: childAuth, modelRegistry: childRegistry } = sharedFauxSetup("signal-abort-child");
    const { faux: gcFaux, auth: gcAuth, modelRegistry: gcRegistry } = sharedFauxSetup("signal-abort-gc");
    const activeSessions = trackActiveSessions();
    try {
      childFaux.setResponses([
        fauxAssistantMessage([fauxToolCall("task_delegate", { role: "coder", slug: "gc-signal-aborted", body: "do something" })], { stopReason: "toolUse" }),
      ]);
      gcFaux.setResponses([
        fauxAssistantMessage([], { stopReason: "aborted", errorMessage: "Request was aborted." } as any),
      ]);

      const controller = new AbortController();
      const resultPromise = startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "child-signal-abort-grandchild",
        body: "delegate to a coder",
        activeSessions,
        pi: {} as any,
        postOutput: () => {},
        signal: controller.signal,
        nestedDelegateToolFactory: (shortRole) => ({
          ...makeTaskDelegateDefinition(shortRole, activeSessions, {} as any, () => {}),
          execute: async (_id: string, params: any, _signal: any, _onUpdate: any, _ctx: any) => {
            queueMicrotask(() => controller.abort());
            const { startChildSession: startGc } = await import("../session-factory.ts");
            const result = await startGc({
              cwd,
              from: shortRole,
              role: params.role,
              slug: params.slug,
              body: params.body,
              activeSessions,
              pi: {} as any,
              postOutput: () => {},
              signal: controller.signal,
              nestedDelegateToolFactory: () => makeTaskDelegateDefinition("coder", activeSessions, {} as any, () => {}),
              model: gcFaux.getModel(),
              authStorage: gcAuth,
              modelRegistry: gcRegistry,
            });
            activeSessions.set(params.slug, result.session);
            return { content: [{ type: "text", text: `Outcome: ${result.outcome}` }], details: {} };
          },
        }),
        model: childFaux.getModel(),
        authStorage: childAuth,
        modelRegistry: childRegistry,
      });

      const result = await resultPromise;
      assert.equal(result.outcome, "aborted");
    } finally {
      await cleanupActiveSessions(activeSessions);
      childFaux.unregister();
      gcFaux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("child session should treat an unknown grandchild aborted result as a technical block", async () => {
    const { cwd } = makeTestGitRepo("child-commissioner");
    const { faux: childFaux, auth: childAuth, modelRegistry: childRegistry } = sharedFauxSetup("abort-child");
    const { faux: gcFaux, auth: gcAuth, modelRegistry: gcRegistry } = sharedFauxSetup("abort-gc");
    const activeSessions = trackActiveSessions();
    try {
      childFaux.setResponses([
        fauxAssistantMessage([fauxToolCall("task_delegate", { role: "coder", slug: "gc-aborted", body: "do something" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("task_finished", {})], { stopReason: "toolUse" }),
      ]);
      gcFaux.setResponses([
        fauxAssistantMessage([], { stopReason: "aborted", errorMessage: "Request was aborted." } as any),
      ]);

      const resultPromise = startChildSession({
        cwd,
        from: "orchestrator",
        role: "po",
        slug: "child-abort-grandchild",
        body: "delegate to a coder",
        activeSessions,
        pi: {} as any,
        postOutput: () => {},
        signal: AbortSignal.timeout(3000),
        nestedDelegateToolFactory: (shortRole) => ({
          ...makeTaskDelegateDefinition(shortRole, activeSessions, {} as any, () => {}),
          execute: async (_id: string, params: any, _signal: any, _onUpdate: any, _ctx: any) => {
            const { startChildSession: startGc } = await import("../session-factory.ts");
            const result = await startGc({
              cwd,
              from: shortRole,
              role: params.role,
              slug: params.slug,
              body: params.body,
              activeSessions,
              pi: {} as any,
              postOutput: () => {},
              nestedDelegateToolFactory: () => makeTaskDelegateDefinition("coder", activeSessions, {} as any, () => {}),
              model: gcFaux.getModel(),
              authStorage: gcAuth,
              modelRegistry: gcRegistry,
            });
            activeSessions.set(params.slug, result.session);
            return { content: [{ type: "text", text: `Outcome: ${result.outcome}` }], details: {} };
          },
        }),
        model: childFaux.getModel(),
        authStorage: childAuth,
        modelRegistry: childRegistry,
      });

      const result = await resultPromise;
      assert.equal(result.outcome, "finished");
    } finally {
      await cleanupActiveSessions(activeSessions);
      childFaux.unregister();
      gcFaux.unregister();
      cleanupTestTempDir(cwd);
    }
  });
});
