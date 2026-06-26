import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {AuthStorage, ModelRegistry} from "@earendil-works/pi-coding-agent";
import initUnfolding from "../index.ts";
import {createTask, readTask, updateTaskStatus} from "../task-store.ts";
import {createSnapshotCommit} from "../git-task-state.ts";
import {cleanupTestTempDir, makeTestTempDir} from "./test-temp.ts";
import {makeTestGitRepo} from "./test-git-repo.ts";
import {createChildTaskTools} from "../child-task-tools.ts";
import {fauxAssistantMessage, fauxToolCall, registerFauxProvider} from "./faux-provider.ts";

function fauxSetup(name: string) {
  const provider = `${name}-${Date.now()}`;
  const faux = registerFauxProvider({provider, models: [{id: "test-model"}]});
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(provider, "test-key");
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  return {faux, authStorage, modelRegistry};
}

function setupPi(activeSessions?: Map<string, any>) {
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const sentMessages: any[] = [];
  const events = new Map<string, any[]>();
  const pi = {
    on(name: string, handler: any) {
      const list = events.get(name) ?? [];
      list.push(handler);
      events.set(name, list);
    },
    registerMessageRenderer() {
    },
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
    registerTool(def: any) {
      tools.set(def.name, def);
    },
    sendMessage(message: any) {
      sentMessages.push(message);
    },
    sendUserMessage() {
    },
    getAllTools() {
      return [
        {name: "task_delegate", sourceInfo: {baseDir: join(process.cwd(), "extensions", "unfolding")}},
        {name: "maven_run", sourceInfo: {baseDir: join(process.cwd(), "extensions", "maven")}},
        {name: "idea_search_symbol", sourceInfo: {baseDir: join(process.cwd(), "extensions", "idea")}},
      ];
    },
    getCommands() {
      return [
        {name: "maven", source: "extension", sourceInfo: {baseDir: join(process.cwd(), "extensions", "maven")}},
        {name: "quarkus", source: "extension", sourceInfo: {baseDir: join(process.cwd(), "extensions", "quarkus")}},
      ];
    },
  };
  initUnfolding(pi as any, {activeSessions} as any);
  return {tools, commands, sentMessages, events, pi};
}

describe("registered task tools", () => {
  it("ask_sensei uses select plus editor for multiple-choice questions in rpc mode", async () => {
    const {tools} = setupPi();
    const tool = tools.get("ask_sensei");
    assert.ok(tool, "ask_sensei tool must be registered");

    const calls: Array<{ method: string; prompt: string; options?: string[]; prefill?: string }> = [];
    const result = await tool.execute(
      "1",
      {question: "Choose one", context: "Feature: Login", options: ["A", "B"]},
      undefined,
      undefined,
      {
        cwd: ".",
        hasUI: true,
        mode: "rpc",
        ui: {
          async select(prompt: string, options: string[]) {
            calls.push({method: "select", prompt, options});
            return "B";
          },
          async editor(prompt: string, prefill: string) {
            calls.push({method: "editor", prompt, prefill});
            return "B, but keep the build minimal";
          },
        },
      },
    );

    assert.deepEqual(calls, [
      {method: "select", prompt: "Feature: Login\n\nChoose one", options: ["A", "B"]},
      {method: "editor", prompt: "Feature: Login\n\nChoose one", prefill: "B"},
    ]);
    assert.equal(result.content[0].text, "B, but keep the build minimal");
    assert.equal(result.details.answer, "B, but keep the build minimal");
  });

  it("ask_sensei uses input for free-text questions", async () => {
    const {tools} = setupPi();
    const tool = tools.get("ask_sensei");
    assert.ok(tool, "ask_sensei tool must be registered");

    const result = await tool.execute(
      "1",
      {question: "Why?", placeholder: "type answer"},
      undefined,
      undefined,
      {
        cwd: ".",
        hasUI: true,
        ui: {
          async input(prompt: string, placeholder: string) {
            assert.equal(prompt, "Why?");
            assert.equal(placeholder, "type answer");
            return "Because";
          },
        },
      },
    );

    assert.equal(result.content[0].text, "Because");
    assert.equal(result.details.answer, "Because");
  });

  it("ask_sensei lets rpc users replace a selected option in the editor", async () => {
    const {tools} = setupPi();
    const tool = tools.get("ask_sensei");
    assert.ok(tool, "ask_sensei tool must be registered");

    const result = await tool.execute(
      "1",
      {question: "Pick or revise", options: ["A", "B"]},
      undefined,
      undefined,
      {
        cwd: ".",
        hasUI: true,
        mode: "rpc",
        ui: {
          async select(_prompt: string, options: string[]) {
            assert.deepEqual(options, ["A", "B"]);
            return "A";
          },
          async editor(prompt: string, prefill: string) {
            assert.equal(prompt, "Pick or revise");
            assert.equal(prefill, "A");
            return "C";
          },
        },
      },
    );

    assert.equal(result.content[0].text, "C");
    assert.equal(result.details.answer, "C");
  });

  it("child ask_sensei proxies through commissioner callback", async () => {
    const asks: any[] = [];
    const [tool] = createChildTaskTools(".", "child", {name: "task_delegate"} as any, {
      activeSessions: new Map() as any,
      postOutput: () => {
      },
      pi: {} as any,
      askSensei: async (params) => {
        asks.push(params);
        return "5";
      },
    }).filter(tool => tool.name === "ask_sensei");

    const result = await tool.execute("1", {question: "2+3?"});

    assert.deepEqual(asks, [{question: "2+3?"}]);
    assert.equal(result.content[0].text, "5");
    assert.equal(result.details.answer, "5");
  });

  it("root ask_sensei treats dialog cancellation as a normal abort", async () => {
    const {tools} = setupPi();
    const tool = tools.get("ask_sensei");
    assert.ok(tool, "ask_sensei tool must be registered");

    await assert.rejects(
      () => tool.execute("1", {question: "Why?"}, undefined, undefined, {
        cwd: ".",
        hasUI: true,
        mode: "rpc",
        ui: {
          async input() {
            return undefined;
          },
        },
      }),
      /request was aborted/,
    );
  });

  it("root ask_sensei fails hard when UI is unavailable", async () => {
    const {tools} = setupPi();
    const tool = tools.get("ask_sensei");
    assert.ok(tool, "ask_sensei tool must be registered");

    await assert.rejects(
      () => tool.execute("1", {question: "Why?"}, undefined, undefined, {cwd: ".", hasUI: false, ui: {}}),
      /ask_sensei failed: UI is not available in this session/,
    );
  });

  it("child ask_sensei fails hard when the commissioner callback is missing", async () => {
    const [tool] = createChildTaskTools(".", "child", {name: "task_delegate"} as any, {
      activeSessions: new Map() as any,
      postOutput: () => {
      },
      pi: {} as any,
    }).filter(tool => tool.name === "ask_sensei");

    await assert.rejects(
      () => tool.execute("1", {question: "2+3?"}),
      /ask_sensei failed: no commissioner UI callback is available for this child session/,
    );
  });

  it("child task_finished exports html when debug mode is enabled", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    try {
      const sessionFile = join(cwd, "child-finished-session.jsonl");
      writeFileSync(sessionFile, [
        JSON.stringify({type: "session", version: 3, id: "sess-child-finished", timestamp: "2026-06-22T00:00:00.000Z", cwd}),
      ].join("\n") + "\n");
      createTask(cwd, {
        slug: "child-finished",
        from: "orchestrator",
        to: "po",
        body: "Done",
        session_file: sessionFile,
      });

      const [tool] = createChildTaskTools(cwd, "child-finished", {name: "task_delegate"} as any, {
        activeSessions: new Map() as any,
        postOutput: () => {
        },
        pi: {} as any,
        debugExportsEnabled: true,
      }).filter(tool => tool.name === "task_finished");

      let aborted = false;
      await tool.execute("1", {}, undefined, undefined, {
        abort() {
          aborted = true;
        },
      });

      assert.equal(aborted, true);
      assert.equal(existsSync(join(cwd, ".pi", "unfolding", "exports", "child-finished.html")), true);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("child task_block exports html when debug mode is enabled", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    try {
      const sessionFile = join(cwd, "child-blocked-session.jsonl");
      writeFileSync(sessionFile, [
        JSON.stringify({type: "session", version: 3, id: "sess-child-blocked", timestamp: "2026-06-22T00:00:00.000Z", cwd}),
      ].join("\n") + "\n");
      createTask(cwd, {
        slug: "child-blocked",
        from: "orchestrator",
        to: "po",
        body: "Blocked",
        session_file: sessionFile,
      });

      const [tool] = createChildTaskTools(cwd, "child-blocked", {name: "task_delegate"} as any, {
        activeSessions: new Map() as any,
        postOutput: () => {
        },
        pi: {} as any,
        debugExportsEnabled: true,
      }).filter(tool => tool.name === "task_block");

      let aborted = false;
      await tool.execute("1", {blocked_reason: "need help"}, undefined, undefined, {
        abort() {
          aborted = true;
        },
      });

      assert.equal(aborted, true);
      assert.equal(existsSync(join(cwd, ".pi", "unfolding", "exports", "child-blocked.html")), true);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("task_rollback tool rolls back a finished task", async () => {
    const {cwd, head: baseSha} = makeTestGitRepo("index-tools");
    try {
      writeFileSync(join(cwd, "docs", "README.md"), "seed\npre-task dirty\n");
      writeFileSync(join(cwd, "notes.txt"), "untracked before delegate\n");
      const snapshotSha = createSnapshotCommit(cwd);

      createTask(cwd, {
        slug: "rollback-finished",
        from: "orchestrator",
        to: "po",
        body: "Done",
        base_sha: baseSha,
        snapshot_sha: snapshotSha,
      });
      updateTaskStatus(cwd, "rollback-finished", "finished");

      writeFileSync(join(cwd, "docs", "README.md"), "seed\ntask changed\n");
      writeFileSync(join(cwd, "task-temp.txt"), "created by task\n");

      const {tools} = setupPi();
      const tool = tools.get("task_rollback");
      assert.ok(tool, "task_rollback tool must be registered");

      const result = await tool.execute("1", {slug: "rollback-finished"}, undefined, undefined, {cwd});

      assert.equal(result.content[0].text, 'Task "rollback-finished" rolled back.');
      assert.equal(readTask(cwd, "rollback-finished"), null);
      assert.equal(execFileSync("git", ["rev-parse", "HEAD"], {cwd, encoding: "utf8"}).trim(), baseSha);
      assert.equal(readFileSync(join(cwd, "docs", "README.md"), "utf8"), "seed\npre-task dirty\n");
      assert.equal(readFileSync(join(cwd, "notes.txt"), "utf8"), "untracked before delegate\n");
      assert.equal(existsSync(join(cwd, "task-temp.txt")), false);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("task_rollback tool aborts a live in-progress session before rollback", async () => {
    const {cwd, head: baseSha} = makeTestGitRepo("index-tools");
    try {
      const activeSessions = new Map<string, any>();
      let aborted = false;
      activeSessions.set("rollback-live", {
        abort: async () => {
          aborted = true;
        },
      });

      createTask(cwd, {
        slug: "rollback-live",
        from: "orchestrator",
        to: "po",
        body: "In progress",
        base_sha: baseSha,
      });

      writeFileSync(join(cwd, "docs", "README.md"), "seed\ntask changed\n");
      const {tools} = setupPi(activeSessions);
      const tool = tools.get("task_rollback");
      assert.ok(tool, "task_rollback tool must be registered");

      await tool.execute("1", {slug: "rollback-live"}, undefined, undefined, {cwd});

      assert.equal(aborted, true, "live child session should be aborted");
      assert.equal(activeSessions.has("rollback-live"), false, "live session handle should be removed");
      assert.equal(readTask(cwd, "rollback-live"), null);
      assert.equal(readFileSync(join(cwd, "docs", "README.md"), "utf8"), "seed\n");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("task_accept exports html when /unfold --debug enabled", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    try {
      const sessionFile = join(cwd, "fake-session.jsonl");
      writeFileSync(sessionFile, [
        JSON.stringify({type: "session", version: 3, id: "sess-1", timestamp: "2026-06-22T00:00:00.000Z", cwd}),
        JSON.stringify({
          type: "message",
          id: "m1",
          parentId: null,
          timestamp: "2026-06-22T00:00:01.000Z",
          message: {role: "user", content: [{type: "text", text: "hello"}], timestamp: 1}
        }),
        JSON.stringify({
          type: "message",
          id: "m2",
          parentId: "m1",
          timestamp: "2026-06-22T00:00:02.000Z",
          message: {role: "assistant", content: [{type: "text", text: "world"}], stopReason: "stop", timestamp: 2}
        }),
      ].join("\n") + "\n");
      createTask(cwd, {
        slug: "accept-debug",
        from: "orchestrator",
        to: "po",
        body: "Done",
        session_file: sessionFile,
      });
      updateTaskStatus(cwd, "accept-debug", "finished");

      const {tools, commands} = setupPi();
      const unfold = commands.get("unfold");
      assert.ok(unfold, "unfold command must be registered");
      await unfold.handler("--debug", {
        cwd,
        isIdle: () => true,
        ui: {
          notify() {
          }
        },
      });

      const tool = tools.get("task_accept");
      assert.ok(tool, "task_accept tool must be registered");
      await tool.execute("1", {slug: "accept-debug"}, undefined, undefined, {cwd});

      assert.equal(existsSync(join(cwd, ".pi", "unfolding", "exports", "accept-debug.html")), true);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("task_rollback exports html when /unfold --debug enabled", async () => {
    const {cwd, head: baseSha} = makeTestGitRepo("index-tools");
    const sessionDir = makeTestTempDir("index-tools-session");
    try {
      const sessionFile = join(sessionDir, "fake-session.jsonl");
      writeFileSync(sessionFile, [
        JSON.stringify({type: "session", version: 3, id: "sess-2", timestamp: "2026-06-22T00:00:00.000Z", cwd}),
        JSON.stringify({
          type: "message",
          id: "m1",
          parentId: null,
          timestamp: "2026-06-22T00:00:01.000Z",
          message: {role: "user", content: [{type: "text", text: "hello"}], timestamp: 1}
        }),
      ].join("\n") + "\n");
      createTask(cwd, {
        slug: "rollback-debug",
        from: "orchestrator",
        to: "po",
        body: "Done",
        session_file: sessionFile,
        base_sha: baseSha,
      });
      updateTaskStatus(cwd, "rollback-debug", "finished");

      const {tools, commands} = setupPi();
      const unfold = commands.get("unfold");
      assert.ok(unfold, "unfold command must be registered");
      await unfold.handler("--debug", {
        cwd,
        isIdle: () => true,
        ui: {
          notify() {
          }
        },
      });

      const tool = tools.get("task_rollback");
      assert.ok(tool, "task_rollback tool must be registered");
      await tool.execute("1", {slug: "rollback-debug"}, undefined, undefined, {cwd});

      assert.equal(existsSync(join(cwd, ".pi", "unfolding", "exports", "rollback-debug.html")), true);
    } finally {
      cleanupTestTempDir(cwd);
      cleanupTestTempDir(sessionDir);
    }
  });

  it("task_delegate aborts the full session stack when the child outcome is aborted and keeps the final nested transcript visible", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    try {
      const {tools, sentMessages} = setupPi();
      const controller = new AbortController();
      controller.abort();
      const updates: string[] = [];
      const tool = tools.get("task_delegate");
      assert.ok(tool, "task_delegate tool must be registered");

      const result = await tool.execute("1", {
        role: "coder",
        slug: "aborted-transcript",
        body: "Do work"
      }, controller.signal, (update: any) => {
        updates.push(update.content[0].text);
      }, {cwd, abort() {
      }});

      assert.match(result.content[0].text, /^Task "aborted-transcript" aborted\./);
      assert.equal(result.details?.aborted, true);
      assert.equal(result.terminate, true);
      assert.ok(updates.some(text => text.includes("[coder/aborted-transcript]")), "transient nested transcript should be streamed before abort");
      assert.match(result.content[0].text, /\[coder\/aborted-transcript\]/);
      assert.match(result.content[0].text, /💰 \$/);
      assert.match(result.content[0].text, /⛔ unfolding aborted/);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("task_delegate aborts the full session stack and exports html when the child outcome is aborted and /unfold --debug enabled", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    const sessionDir = makeTestTempDir("index-tools-session");
    try {
      const sessionFile = join(sessionDir, "fake-session.jsonl");
      writeFileSync(sessionFile, [
        JSON.stringify({type: "session", version: 3, id: "sess-3", timestamp: "2026-06-22T00:00:00.000Z", cwd}),
        JSON.stringify({
          type: "message",
          id: "m1",
          parentId: null,
          timestamp: "2026-06-22T00:00:01.000Z",
          message: {role: "user", content: [{type: "text", text: "hello"}], timestamp: 1}
        }),
      ].join("\n") + "\n");
      createTask(cwd, {
        slug: "aborted-debug",
        from: "orchestrator",
        to: "coder",
        body: "Do work",
        session_file: sessionFile,
      });

      const {tools, commands} = setupPi();
      const unfold = commands.get("unfold");
      assert.ok(unfold, "unfold command must be registered");
      await unfold.handler("--debug", {
        cwd,
        isIdle: () => true,
        ui: {
          notify() {
          }
        },
      });

      const controller = new AbortController();
      controller.abort();
      const tool = tools.get("task_delegate");
      assert.ok(tool, "task_delegate tool must be registered");
      const result = await tool.execute("1", {
        role: "coder",
        slug: "aborted-debug",
        body: "Do work"
      }, controller.signal, undefined, {cwd, abort() {
      }});

      assert.match(result.content[0].text, /^Task "aborted-debug" aborted\./);
      assert.equal(result.details?.aborted, true);
      assert.equal(result.terminate, true);
      assert.match(result.content[0].text, /⛔ unfolding aborted/);
      assert.equal(existsSync(join(cwd, ".pi", "unfolding", "exports", "aborted-debug.html")), true);
    } finally {
      cleanupTestTempDir(cwd);
      cleanupTestTempDir(sessionDir);
    }
  });


  it("task_delegate includes blocked_reason for blocked children", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    const {faux, authStorage, modelRegistry} = fauxSetup("index-tools-blocked-child");
    try {
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("task_block", {blocked_reason: "need architecture decision"})], {stopReason: "toolUse"}),
        fauxAssistantMessage("blocked"),
      ]);

      const {tools} = setupPi();
      const tool = tools.get("task_delegate");
      assert.ok(tool, "task_delegate tool must be registered");
      const updates: any[] = [];
      const result = await tool.execute("1", {
        role: "coder",
        slug: "blocked-child",
        body: "Do work"
      }, AbortSignal.timeout(3000), (update: any) => {
        updates.push(update);
      }, {cwd, model: faux.getModel(), authStorage, modelRegistry});

      assert.match(result.content[0].text, /Outcome: blocked/);
      assert.match(result.content[0].text, /blocked_reason: need architecture decision/);
      assert.equal(result.details?.blocked_reason, "need architecture decision");
      assert.ok(updates.length > 0, "expected streamed child output updates for blocked child");
      const finalUpdate = updates[updates.length - 1];
      assert.equal(finalUpdate.details?.childOutputRole, "coder");
      assert.ok(Array.isArray(finalUpdate.details?.childOutputEvents), "expected final child output events for blocked child");
      assert.match(JSON.stringify(finalUpdate.details?.childOutputEvents), /blocked: need architecture decision/);
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("task_delegate returns final child output details for finished children", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    const {faux, authStorage, modelRegistry} = fauxSetup("index-tools-finished-child");
    try {
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("task_finished", {})], {stopReason: "toolUse"}),
        fauxAssistantMessage([], {stopReason: "aborted", errorMessage: "Request was aborted."} as any),
      ]);

      const {tools} = setupPi();
      const tool = tools.get("task_delegate");
      assert.ok(tool, "task_delegate tool must be registered");
      const updates: any[] = [];
      const result = await tool.execute("1", {
        role: "coder",
        slug: "finished-child",
        body: "Do work"
      }, AbortSignal.timeout(3000), (update: any) => {
        updates.push(update);
      }, {cwd, model: faux.getModel(), authStorage, modelRegistry});

      assert.match(result.content[0].text, /Outcome: finished/);
      assert.ok(updates.length > 0, "expected streamed child output updates for finished child");
      const finalUpdate = updates[updates.length - 1];
      assert.equal(finalUpdate.details?.childOutputRole, "coder");
      assert.ok(Array.isArray(finalUpdate.details?.childOutputEvents), "expected final child output events for finished child");
      assert.match(JSON.stringify(finalUpdate.details?.childOutputEvents), /task_finished/);
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("task_delegate returns an aborted result instead of throwing when delegation is aborted", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    try {
      const {tools} = setupPi();
      const controller = new AbortController();
      controller.abort();
      const tool = tools.get("task_delegate");
      assert.ok(tool, "task_delegate tool must be registered");
      const result = await tool.execute("1", {
        role: "coder",
        slug: "aborted-child",
        body: "Do work"
      }, controller.signal, undefined, {cwd, abort() {
      }});

      assert.match(result.content[0].text, /^Task "aborted-child" aborted\./);
      assert.equal(result.details?.aborted, true);
      assert.equal(result.terminate, true);
      assert.match(result.content[0].text, /⛔ unfolding aborted/);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("task_unblock returns an aborted result instead of throwing when the resumed child run is aborted", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    try {
      createTask(cwd, {
        slug: "unblock-aborted",
        from: "orchestrator",
        to: "coder",
        body: "Do work",
      });
      updateTaskStatus(cwd, "unblock-aborted", "blocked", "waiting");

      const activeSessions = new Map<string, any>();
      activeSessions.set("unblock-aborted", {
        isStreaming: false,
        prompt: async () => {
        },
        getSessionStats: () => ({cost: 0, tokens: {input: 0, output: 0}}),
      });

      const {tools} = setupPi(activeSessions);
      const controller = new AbortController();
      controller.abort();
      const tool = tools.get("task_unblock");
      assert.ok(tool, "task_unblock tool must be registered");
      const result = await tool.execute("1", {slug: "unblock-aborted", reason: "continue"}, controller.signal, undefined, {cwd, abort() {
      }});

      assert.match(result.content[0].text, /^Task "unblock-aborted" aborted\./);
      assert.equal(result.details?.aborted, true);
      assert.equal(result.terminate, true);
      assert.match(result.content[0].text, /⛔ unfolding aborted/);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("task_unblock exports html when /unfold --debug enabled", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    const sessionDir = makeTestTempDir("index-tools-session");
    try {
      const sessionFile = join(sessionDir, "fake-session.jsonl");
      writeFileSync(sessionFile, [
        JSON.stringify({type: "session", version: 3, id: "sess-5", timestamp: "2026-06-22T00:00:00.000Z", cwd}),
        JSON.stringify({
          type: "message",
          id: "m1",
          parentId: null,
          timestamp: "2026-06-22T00:00:01.000Z",
          message: {role: "user", content: [{type: "text", text: "hello"}], timestamp: 1}
        }),
      ].join("\n") + "\n");
      createTask(cwd, {
        slug: "unblock-debug",
        from: "orchestrator",
        to: "coder",
        body: "Do work",
        session_file: sessionFile,
      });
      updateTaskStatus(cwd, "unblock-debug", "blocked", "waiting");

      const activeSessions = new Map<string, any>();
      let promptCount = 0;
      activeSessions.set("unblock-debug", {
        isStreaming: false,
        prompt: async () => {
          promptCount += 1;
          updateTaskStatus(cwd, "unblock-debug", "finished");
        },
        getSessionStats: () => ({cost: 0, tokens: {input: 0, output: 0}}),
      });

      const {tools, commands} = setupPi(activeSessions);
      const unfold = commands.get("unfold");
      assert.ok(unfold, "unfold command must be registered");
      await unfold.handler("--debug", {
        cwd,
        isIdle: () => true,
        ui: {
          notify() {
          }
        },
      });

      const tool = tools.get("task_unblock");
      assert.ok(tool, "task_unblock tool must be registered");
      const result = await tool.execute("1", {slug: "unblock-debug", reason: "continue"}, undefined, undefined, {cwd});

      assert.equal(promptCount, 1);
      assert.match(result.content[0].text, /Outcome: finished/);
      assert.equal(existsSync(join(cwd, ".pi", "unfolding", "exports", "unblock-debug.html")), true);
    } finally {
      cleanupTestTempDir(cwd);
      cleanupTestTempDir(sessionDir);
    }
  });

  it("task_reopen returns an aborted result instead of throwing when the resumed child run is aborted", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    try {
      createTask(cwd, {
        slug: "reopen-aborted",
        from: "orchestrator",
        to: "coder",
        body: "Do work",
      });
      updateTaskStatus(cwd, "reopen-aborted", "finished");

      const activeSessions = new Map<string, any>();
      activeSessions.set("reopen-aborted", {
        isStreaming: false,
        prompt: async () => {
        },
        getSessionStats: () => ({cost: 0, tokens: {input: 0, output: 0}}),
      });

      const {tools} = setupPi(activeSessions);
      const controller = new AbortController();
      controller.abort();
      const tool = tools.get("task_reopen");
      assert.ok(tool, "task_reopen tool must be registered");
      const result = await tool.execute("1", {slug: "reopen-aborted", reason: "redo"}, controller.signal, undefined, {cwd, abort() {
      }});

      assert.match(result.content[0].text, /^Task "reopen-aborted" aborted\./);
      assert.equal(result.details?.aborted, true);
      assert.equal(result.terminate, true);
      assert.match(result.content[0].text, /⛔ unfolding aborted/);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("task_reopen exports html when /unfold --debug enabled", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    const sessionDir = makeTestTempDir("index-tools-session");
    try {
      const sessionFile = join(sessionDir, "fake-session.jsonl");
      writeFileSync(sessionFile, [
        JSON.stringify({type: "session", version: 3, id: "sess-6", timestamp: "2026-06-22T00:00:00.000Z", cwd}),
        JSON.stringify({
          type: "message",
          id: "m1",
          parentId: null,
          timestamp: "2026-06-22T00:00:01.000Z",
          message: {role: "user", content: [{type: "text", text: "hello"}], timestamp: 1}
        }),
      ].join("\n") + "\n");
      createTask(cwd, {
        slug: "reopen-debug",
        from: "orchestrator",
        to: "coder",
        body: "Do work",
        session_file: sessionFile,
      });
      updateTaskStatus(cwd, "reopen-debug", "finished");

      const activeSessions = new Map<string, any>();
      let promptCount = 0;
      activeSessions.set("reopen-debug", {
        isStreaming: false,
        prompt: async () => {
          promptCount += 1;
          updateTaskStatus(cwd, "reopen-debug", "finished");
        },
        getSessionStats: () => ({cost: 0, tokens: {input: 0, output: 0}}),
      });

      const {tools, commands} = setupPi(activeSessions);
      const unfold = commands.get("unfold");
      assert.ok(unfold, "unfold command must be registered");
      await unfold.handler("--debug", {
        cwd,
        isIdle: () => true,
        ui: {
          notify() {
          }
        },
      });

      const tool = tools.get("task_reopen");
      assert.ok(tool, "task_reopen tool must be registered");
      const result = await tool.execute("1", {slug: "reopen-debug", reason: "redo"}, undefined, undefined, {cwd});

      assert.equal(promptCount, 1);
      assert.match(result.content[0].text, /Outcome: finished/);
      assert.equal(existsSync(join(cwd, ".pi", "unfolding", "exports", "reopen-debug.html")), true);
    } finally {
      cleanupTestTempDir(cwd);
      cleanupTestTempDir(sessionDir);
    }
  });

  it("does not export html when debug mode is off", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    try {
      const sessionFile = join(cwd, "fake-session.jsonl");
      writeFileSync(sessionFile, [
        JSON.stringify({type: "session", version: 3, id: "sess-4", timestamp: "2026-06-22T00:00:00.000Z", cwd}),
        JSON.stringify({
          type: "message",
          id: "m1",
          parentId: null,
          timestamp: "2026-06-22T00:00:01.000Z",
          message: {role: "user", content: [{type: "text", text: "hello"}], timestamp: 1}
        }),
      ].join("\n") + "\n");
      createTask(cwd, {
        slug: "accept-nodebug",
        from: "orchestrator",
        to: "po",
        body: "Done",
        session_file: sessionFile,
      });
      updateTaskStatus(cwd, "accept-nodebug", "finished");

      const {tools} = setupPi();
      const tool = tools.get("task_accept");
      assert.ok(tool, "task_accept tool must be registered");
      await tool.execute("1", {slug: "accept-nodebug"}, undefined, undefined, {cwd});

      assert.equal(existsSync(join(cwd, ".pi", "unfolding", "exports", "accept-nodebug.html")), false);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});
