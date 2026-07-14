import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {AuthStorage, ModelRegistry} from "@earendil-works/pi-coding-agent";
import initUnfolding from "../index.ts";
import {createTask, readTask, updateTaskStatus} from "../task-store.ts";
import {createSnapshotCommit} from "../git-task-state.ts";
import {cleanupTestTempDir, makeTestTempDir} from "./test-temp.ts";
import {makeTestGitRepo} from "./test-git-repo.ts";
import {createChildTaskTools} from "../child-task-tools.ts";
import {makeTaskDelegateDefinition} from "../task-delegate-tool.ts";
import {fauxAssistantMessage, fauxToolCall, registerFauxProvider} from "./faux-provider.ts";

function fauxSetup(name: string) {
  const provider = `${name}-${Date.now()}`;
  const faux = registerFauxProvider({provider, models: [{id: "test-model"}]});
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(provider, "test-key");
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  return {faux, authStorage, modelRegistry};
}

function listExportFiles(cwd: string): string[] {
  const dir = join(cwd, ".pi", "unfolding", "exports");
  return existsSync(dir) ? readdirSync(dir) : [];
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
    sendUserMessage(message: any) {
      sentMessages.push(message);
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
  it("hard-fails task_list diagnostics on an invalid top-level tree", async () => {
    const cwd = makeTestTempDir("invalid-root-tree");
    try {
      writeFileSync(join(cwd, ".keep"), "");
      mkdirSync(join(cwd, ".pi", "unfolding", "tasks"), { recursive: true });
      writeFileSync(join(cwd, ".pi", "unfolding", "tasks", "bad-root.yaml"), [
        "slug: arch-root",
        "status: in_progress",
        "from: orchestrator",
        "to: architect",
        "body: |",
        "  bad root",
        "",
      ].join("\n"));
      const { tools } = setupPi();
      const tool = tools.get("task_list");
      await assert.rejects(
        () => tool.execute("1", {}, undefined, undefined, { cwd, signal: undefined }),
        /role "orchestrator" may not delegate to "architect"|top-level task must be orchestrator -> po/,
      );
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("hard-fails task_read diagnostics on an invalid top-level tree", async () => {
    const cwd = makeTestTempDir("invalid-root-tree");
    try {
      writeFileSync(join(cwd, ".keep"), "");
      mkdirSync(join(cwd, ".pi", "unfolding", "tasks"), { recursive: true });
      writeFileSync(join(cwd, ".pi", "unfolding", "tasks", "bad-root.yaml"), [
        "slug: arch-root",
        "status: in_progress",
        "from: orchestrator",
        "to: architect",
        "body: |",
        "  bad root",
        "",
      ].join("\n"));
      const { tools } = setupPi();
      const tool = tools.get("task_read");
      await assert.rejects(
        () => tool.execute("1", { slug: "arch-root" }, undefined, undefined, { cwd, signal: undefined }),
        /role "orchestrator" may not delegate to "architect"|top-level task must be orchestrator -> po/,
      );
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

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

  it("child ask_sensei uses the child session UI proxy", async () => {
    const [tool] = createChildTaskTools(".", "child", {name: "task_delegate"} as any, {name: "task_continue"} as any, {
      activeSessions: new Map() as any,
      postOutput: () => {
      },
      pi: {} as any,
    }).filter(tool => tool.name === "ask_sensei");

    const result = await tool.execute("1", {question: "2+3?"}, undefined, undefined, {
      mode: "rpc",
      ui: {
        async input(prompt: string) {
          assert.equal(prompt, "2+3?");
          return "5";
        },
      },
    });

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

  it("child ask_sensei treats proxied dialog cancellation as a normal abort", async () => {
    const [tool] = createChildTaskTools(".", "child", {name: "task_delegate"} as any, {name: "task_continue"} as any, {
      activeSessions: new Map() as any,
      postOutput: () => {
      },
      pi: {} as any,
    }).filter(tool => tool.name === "ask_sensei");

    await assert.rejects(
      () => tool.execute("1", {question: "2+3?"}, undefined, undefined, {
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

      const [tool] = createChildTaskTools(cwd, "child-finished", {name: "task_delegate"} as any, {name: "task_continue"} as any, {
        activeSessions: new Map() as any,
        postOutput: () => {
        },
        pi: {} as any,
        debugExportsEnabled: true,
      }).filter(tool => tool.name === "task_finished");

      let aborted = false;
      const result = await tool.execute("1", {}, undefined, undefined, {
        abort() {
          aborted = true;
        },
      });

      assert.equal(aborted, true);
      assert.equal(result.terminate, true);
      assert.deepEqual(listExportFiles(cwd).filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-child-finished\.html$/.test(name)).length, 1);
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

      const [tool] = createChildTaskTools(cwd, "child-blocked", {name: "task_delegate"} as any, {name: "task_continue"} as any, {
        activeSessions: new Map() as any,
        postOutput: () => {
        },
        pi: {} as any,
        debugExportsEnabled: true,
      }).filter(tool => tool.name === "task_block");

      let aborted = false;
      const result = await tool.execute("1", {blocked_reason: "need help"}, undefined, undefined, {
        abort() {
          aborted = true;
        },
      });

      assert.equal(aborted, true);
      assert.equal(result.terminate, true);
      assert.deepEqual(listExportFiles(cwd).filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-child-blocked\.html$/.test(name)).length, 1);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("child task_reopen exports commissioner html when debug mode is enabled", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    try {
      createTask(cwd, {
        slug: "child-reopen-debug",
        from: "po",
        to: "coder",
        body: "Redo",
      });
      updateTaskStatus(cwd, "child-reopen-debug", "finished");

      const commissionerSessionFile = join(cwd, "child-commissioner-reopen-session.jsonl");
      writeFileSync(commissionerSessionFile, [
        JSON.stringify({type: "session", version: 3, id: "sess-child-commissioner-reopen", timestamp: "2026-06-22T00:00:00.000Z", cwd}),
      ].join("\n") + "\n");

      const activeSessions = new Map<string, any>();
      activeSessions.set("child-reopen-debug", {
        isStreaming: false,
        prompt: async () => {
          updateTaskStatus(cwd, "child-reopen-debug", "finished");
        },
        getSessionStats: () => ({cost: 0, tokens: {input: 0, output: 0}}),
      });

      const [tool] = createChildTaskTools(cwd, "commissioner", {name: "task_delegate"} as any, {name: "task_continue"} as any, {
        activeSessions: activeSessions as any,
        postOutput: () => {
        },
        pi: {} as any,
        debugExportsEnabled: true,
      }).filter(tool => tool.name === "task_reopen");

      const result = await tool.execute("1", {slug: "child-reopen-debug", reason: "redo"}, undefined, undefined, {
        sessionManager: { getSessionFile: () => commissionerSessionFile },
      });

      assert.match(result.content[0].text, /Outcome: finished/);
      assert.deepEqual(listExportFiles(cwd).filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-child-reopen-debug\.commissioner\.html$/.test(name)).length, 1);
      assert.deepEqual(listExportFiles(cwd).filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-child-reopen-debug\.html$/.test(name)).length, 0);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("child task_unblock exports commissioner html when debug mode is enabled", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    try {
      createTask(cwd, {
        slug: "child-unblock-debug",
        from: "po",
        to: "coder",
        body: "Continue",
      });
      updateTaskStatus(cwd, "child-unblock-debug", "blocked", "waiting");

      const commissionerSessionFile = join(cwd, "child-commissioner-unblock-session.jsonl");
      writeFileSync(commissionerSessionFile, [
        JSON.stringify({type: "session", version: 3, id: "sess-child-commissioner-unblock", timestamp: "2026-06-22T00:00:00.000Z", cwd}),
      ].join("\n") + "\n");

      const activeSessions = new Map<string, any>();
      activeSessions.set("child-unblock-debug", {
        isStreaming: false,
        prompt: async () => {
          updateTaskStatus(cwd, "child-unblock-debug", "finished");
        },
        getSessionStats: () => ({cost: 0, tokens: {input: 0, output: 0}}),
      });

      const [tool] = createChildTaskTools(cwd, "commissioner", {name: "task_delegate"} as any, {name: "task_continue"} as any, {
        activeSessions: activeSessions as any,
        postOutput: () => {
        },
        pi: {} as any,
        debugExportsEnabled: true,
      }).filter(tool => tool.name === "task_unblock");

      const result = await tool.execute("1", {slug: "child-unblock-debug", reason: "continue"}, undefined, undefined, {
        sessionManager: { getSessionFile: () => commissionerSessionFile },
      });

      assert.match(result.content[0].text, /Outcome: finished/);
      assert.deepEqual(listExportFiles(cwd).filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-child-unblock-debug\.commissioner\.html$/.test(name)).length, 1);
      assert.deepEqual(listExportFiles(cwd).filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-child-unblock-debug\.html$/.test(name)).length, 0);
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


  it("/unfold sends a fresh-project instruction when no top-level PO task exists", async () => {
    const cwd = makeTestTempDir("unfold-command");
    try {
      const {commands, sentMessages} = setupPi();
      const unfold = commands.get("unfold");
      assert.ok(unfold, "unfold command must be registered");

      await unfold.handler("", {
        cwd,
        isIdle: () => true,
        ui: { notify() {} },
      });

      assert.equal(sentMessages.length, 1);
      assert.match(sentMessages[0], /No live top-level PO task found/);
      assert.match(sentMessages[0], /delegating to the PO/);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("/unfold sends an in-progress resume instruction for the top-level PO task", async () => {
    const cwd = makeTestTempDir("unfold-command");
    try {
      createTask(cwd, { slug: "po-login", from: "orchestrator", to: "po", body: "Define login" });
      const {commands, sentMessages} = setupPi();
      const unfold = commands.get("unfold");
      assert.ok(unfold, "unfold command must be registered");

      await unfold.handler("", {
        cwd,
        isIdle: () => true,
        ui: { notify() {} },
      });

      assert.equal(sentMessages.length, 1);
      assert.match(sentMessages[0], /Current top-level PO task `po-login` is in progress/);
      assert.match(sentMessages[0], /do not start a new one/);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("/unfold sends a blocked instruction for the top-level PO task", async () => {
    const cwd = makeTestTempDir("unfold-command");
    try {
      createTask(cwd, { slug: "po-login", from: "orchestrator", to: "po", body: "Define login" });
      updateTaskStatus(cwd, "po-login", "blocked", "waiting for product clarification");
      const {commands, sentMessages} = setupPi();
      const unfold = commands.get("unfold");
      assert.ok(unfold, "unfold command must be registered");

      await unfold.handler("", {
        cwd,
        isIdle: () => true,
        ui: { notify() {} },
      });

      assert.equal(sentMessages.length, 1);
      assert.match(sentMessages[0], /Current top-level PO task `po-login` is blocked: waiting for product clarification/);
      assert.match(sentMessages[0], /Resolve the commissioner issue and then resume that task/);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("/unfold sends a finished instruction for the top-level PO task", async () => {
    const cwd = makeTestTempDir("unfold-command");
    try {
      createTask(cwd, { slug: "po-login", from: "orchestrator", to: "po", body: "Define login" });
      updateTaskStatus(cwd, "po-login", "finished");
      const {commands, sentMessages} = setupPi();
      const unfold = commands.get("unfold");
      assert.ok(unfold, "unfold command must be registered");

      await unfold.handler("", {
        cwd,
        isIdle: () => true,
        ui: { notify() {} },
      });

      assert.equal(sentMessages.length, 1);
      assert.match(sentMessages[0], /Current top-level PO task `po-login` is finished but unresolved/);
      assert.match(sentMessages[0], /task_accept\(\.\.\.\), task_reopen\(\.\.\.\), or task_rollback\(\.\.\.\)/);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("task_delegate aborts the full session stack without leaking the nested transcript into tool-result content", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    try {
      const {tools, sentMessages} = setupPi();
      const controller = new AbortController();
      controller.abort();
      const updates: string[] = [];
      const tool = tools.get("task_delegate");
      assert.ok(tool, "task_delegate tool must be registered");

      const result = await tool.execute("1", {
        role: "po",
        slug: "aborted-transcript",
        body: "Do work"
      }, controller.signal, (update: any) => {
        updates.push(update.content[0].text);
      }, {cwd, abort() {
      }});

      assert.match(result.content[0].text, /^Task "aborted-transcript" aborted\./);
      assert.equal(result.details?.aborted, true);
      assert.equal(result.terminate, true);
      assert.ok(updates.some(text => text.includes("[po/aborted-transcript]")), "transient nested transcript should be streamed before abort");
      assert.doesNotMatch(result.content[0].text, /\[po\/aborted-transcript\]/);
      assert.doesNotMatch(result.content[0].text, /💰 \$/);
      assert.doesNotMatch(result.content[0].text, /⛔ unfolding aborted/);
      assert.equal(result.details?.childOutputRole, "po");
      assert.ok(Array.isArray(result.details?.childOutputEvents), "expected nested transcript in details");
      assert.match(JSON.stringify(result.details?.childOutputEvents), /aborted-transcript/);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("task_continue aborts the full session stack and exports child html when the child outcome is aborted and /unfold --debug enabled", async () => {
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
        to: "po",
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
      const tool = tools.get("task_continue");
      assert.ok(tool, "task_continue tool must be registered");
      const result = await tool.execute("1", {}, controller.signal, undefined, {cwd, abort() {
      }});

      assert.match(result.content[0].text, /^Task "aborted-debug" aborted\./);
      assert.equal(result.details?.aborted, true);
      assert.equal(result.terminate, true);
      assert.doesNotMatch(result.content[0].text, /\[coder\/aborted-debug\]/);
      assert.doesNotMatch(result.content[0].text, /💰 \$/);
      assert.doesNotMatch(result.content[0].text, /⛔ unfolding aborted/);
      assert.deepEqual(listExportFiles(cwd).filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-aborted-debug\.html$/.test(name)).length, 1);
    } finally {
      cleanupTestTempDir(cwd);
      cleanupTestTempDir(sessionDir);
    }
  });


  it("child task_block accepts recreate.resume_message and persists recreate_message", async () => {
    const cwd = makeTestTempDir("child-recreate");
    try {
      createTask(cwd, { slug: "child", from: "orchestrator", to: "po", body: "Do it" });
      const [tool] = createChildTaskTools(cwd, "child", { name: "task_delegate" } as any, { name: "task_continue" } as any, {
        activeSessions: new Map() as any,
        postOutput: () => {},
        pi: {} as any,
      }).filter(tool => tool.name === "task_block");
      let aborted = false;
      const result = await tool.execute("1", { recreate: { resume_message: "bootstrap done; continue with Quarkus tools" } }, undefined, undefined, {
        abort() { aborted = true; },
      });
      const task = readTask(cwd, "child");
      assert.equal(aborted, true);
      assert.equal(result.terminate, true);
      assert.equal(task?.status, "blocked");
      assert.equal(task?.blocked_reason, undefined);
      assert.equal(task?.recreate_message, "bootstrap done; continue with Quarkus tools");
    } finally {
      cleanupTestTempDir(cwd);
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
        role: "po",
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
      assert.equal(finalUpdate.details?.childOutputRole, "po");
      assert.ok(Array.isArray(finalUpdate.details?.childOutputEvents), "expected final child output events for blocked child");
      assert.match(JSON.stringify(finalUpdate.details?.childOutputEvents), /blocked: need architecture decision/);
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("task_delegate exports commissioner html when /unfold --debug enabled", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    try {
      const commissionerSessionFile = join(cwd, "commissioner-delegate-session.jsonl");
      writeFileSync(commissionerSessionFile, [
        JSON.stringify({type: "session", version: 3, id: "sess-commissioner-delegate", timestamp: "2026-06-22T00:00:00.000Z", cwd}),
        JSON.stringify({
          type: "message",
          id: "m1",
          parentId: null,
          timestamp: "2026-06-22T00:00:01.000Z",
          message: {role: "user", content: [{type: "text", text: "delegate"}], timestamp: 1}
        }),
      ].join("\n") + "\n");

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

      const tool = tools.get("task_delegate");
      assert.ok(tool, "task_delegate tool must be registered");
      const controller = new AbortController();
      controller.abort();
      const result = await tool.execute("1", {
        role: "po",
        slug: "delegate-debug",
        body: "Do work"
      }, controller.signal, undefined, {
        cwd,
        sessionManager: { getSessionFile: () => commissionerSessionFile },
        abort() {
        }
      });

      assert.equal(result.terminate, true);
      assert.deepEqual(listExportFiles(cwd).filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-delegate-debug\.commissioner\.html$/.test(name)).length, 1);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("task_delegate skips commissioner html export when the commissioner session file is missing", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    try {
      const missingCommissionerSessionFile = join(cwd, "missing-commissioner-session.jsonl");

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

      const tool = tools.get("task_delegate");
      assert.ok(tool, "task_delegate tool must be registered");
      const controller = new AbortController();
      controller.abort();
      const result = await tool.execute("1", {
        role: "po",
        slug: "delegate-debug-missing-session",
        body: "Do work"
      }, controller.signal, undefined, {
        cwd,
        sessionManager: { getSessionFile: () => missingCommissionerSessionFile },
        abort() {
        }
      });

      assert.equal(result.terminate, true);
      assert.deepEqual(listExportFiles(cwd).filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-delegate-debug-missing-session\.commissioner\.html$/.test(name)).length, 0);
    } finally {
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
        role: "po",
        slug: "finished-child",
        body: "Do work"
      }, AbortSignal.timeout(3000), (update: any) => {
        updates.push(update);
      }, {cwd, model: faux.getModel(), authStorage, modelRegistry});

      assert.match(result.content[0].text, /Outcome: finished/);
      assert.ok(updates.length > 0, "expected streamed child output updates for finished child");
      const finalUpdate = updates[updates.length - 1];
      assert.equal(finalUpdate.details?.childOutputRole, "po");
      assert.ok(Array.isArray(finalUpdate.details?.childOutputEvents), "expected final child output events for finished child");
      assert.match(JSON.stringify(finalUpdate.details?.childOutputEvents), /task_finished/);
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("task_delegate renderResult stays total when child output details are missing", async () => {
    const {tools} = setupPi();
    const tool = tools.get("task_delegate");
    assert.ok(tool, "task_delegate tool must be registered");

    const component = tool.renderResult({content: [], details: {}}, {expanded: false}, {bg: (_color: string, text: string) => text});

    assert.ok(component, "renderResult must always return a component");
    assert.deepEqual(component.render(80), []);
  });

  it("root task_delegate aborts the current run when delegation is aborted", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    try {
      const {tools} = setupPi();
      const controller = new AbortController();
      controller.abort();
      const tool = tools.get("task_delegate");
      assert.ok(tool, "task_delegate tool must be registered");
      let abortCalls = 0;
      const result = await tool.execute("1", {
        role: "po",
        slug: "aborted-child",
        body: "Do work"
      }, controller.signal, undefined, {cwd, abort() {
        abortCalls += 1;
      }});

      assert.match(result.content[0].text, /^Task "aborted-child" aborted\./);
      assert.equal(abortCalls, 1);
      assert.equal(result.details?.aborted, true);
      assert.equal(result.terminate, true);
      assert.doesNotMatch(result.content[0].text, /⛔ unfolding aborted/);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("nested task_delegate returns an aborted result without aborting its own commissioner run", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    try {
      const activeSessions = new Map<string, any>();
      const nestedTool = makeTaskDelegateDefinition("architect", activeSessions as any, {} as any, () => {}, undefined, undefined, "arch-1");
      const controller = new AbortController();
      controller.abort();
      let abortCalls = 0;

      const result = await nestedTool.execute("1", {
        role: "coder",
        slug: "aborted-grandchild",
        body: "Do work"
      }, controller.signal, undefined, {cwd, abort() {
        abortCalls += 1;
      }});

      assert.match(result.content[0].text, /^Task "aborted-grandchild" aborted\./);
      assert.equal(abortCalls, 0);
      assert.equal(result.details?.aborted, true);
      assert.equal(result.terminate, true);
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
        to: "po",
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
      let abortCalls = 0;
      const result = await tool.execute("1", {slug: "unblock-aborted", reason: "continue"}, controller.signal, undefined, {cwd, abort() {
        abortCalls += 1;
      }});

      assert.match(result.content[0].text, /^Task "unblock-aborted" aborted\./);
      assert.equal(abortCalls, 1);
      assert.equal(result.details?.aborted, true);
      assert.equal(result.terminate, true);
      assert.doesNotMatch(result.content[0].text, /⛔ unfolding aborted/);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("task_delegate returns an aborted result when its signal aborts during nested delegation", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    const {faux, authStorage, modelRegistry} = fauxSetup("index-tools-late-abort");
    try {
      faux.setResponses([
        fauxAssistantMessage([], {stopReason: "aborted", errorMessage: "Request was aborted."} as any),
      ]);

      const activeSessions = new Map<string, any>();
      const {tools} = setupPi(activeSessions);
      const controller = new AbortController();
      const tool = tools.get("task_delegate");
      assert.ok(tool, "task_delegate tool must be registered");

      const resultPromise = tool.execute("1", {
        role: "po",
        slug: "late-aborted-child",
        body: "Do work"
      }, controller.signal, undefined, {cwd, model: faux.getModel(), authStorage, modelRegistry, abort() {
      }});

      queueMicrotask(() => controller.abort());

      const result = await resultPromise;
      assert.match(result.content[0].text, /^Task "late-aborted-child" aborted\./);
      assert.equal(result.details?.aborted, true);
      assert.equal(result.terminate, true);
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("task_delegate also treats ctx.signal abort as a user abort during nested delegation", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    const {faux, authStorage, modelRegistry} = fauxSetup("index-tools-ctx-signal-abort");
    try {
      faux.setResponses([
        fauxAssistantMessage([], {stopReason: "aborted", errorMessage: "Request was aborted."} as any),
      ]);

      const activeSessions = new Map<string, any>();
      const {tools} = setupPi(activeSessions);
      const controller = new AbortController();
      const tool = tools.get("task_delegate");
      assert.ok(tool, "task_delegate tool must be registered");

      const ctx: any = {
        cwd,
        model: faux.getModel(),
        authStorage,
        modelRegistry,
        abort() {
        },
        get signal() {
          return controller.signal;
        },
      };

      const resultPromise = tool.execute("1", {
        role: "po",
        slug: "ctx-signal-aborted-child",
        body: "Do work"
      }, undefined, undefined, ctx);

      queueMicrotask(() => controller.abort());

      const result = await resultPromise;
      assert.match(result.content[0].text, /^Task "ctx-signal-aborted-child" aborted\./);
      assert.equal(result.details?.aborted, true);
      assert.equal(result.terminate, true);
    } finally {
      faux.unregister();
      cleanupTestTempDir(cwd);
    }
  });

  it("task_unblock exports the commissioner html when /unfold --debug enabled", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    try {
      createTask(cwd, {
        slug: "unblock-debug",
        from: "orchestrator",
        to: "po",
        body: "Do work",
      });
      updateTaskStatus(cwd, "unblock-debug", "blocked", "waiting");

      const commissionerSessionFile = join(cwd, "commissioner-unblock-session.jsonl");
      writeFileSync(commissionerSessionFile, [
        JSON.stringify({type: "session", version: 3, id: "sess-commissioner-unblock", timestamp: "2026-06-22T00:00:00.000Z", cwd}),
      ].join("\n") + "\n");

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
      const result = await tool.execute("1", {slug: "unblock-debug", reason: "continue"}, undefined, undefined, {
        cwd,
        sessionManager: { getSessionFile: () => commissionerSessionFile },
      });

      assert.equal(promptCount, 1);
      assert.match(result.content[0].text, /Outcome: finished/);
      assert.deepEqual(listExportFiles(cwd).filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-unblock-debug\.commissioner\.html$/.test(name)).length, 1);
      assert.deepEqual(listExportFiles(cwd).filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-unblock-debug\.html$/.test(name)).length, 0);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("task_reopen returns an aborted result instead of throwing when the resumed child run is aborted", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    try {
      createTask(cwd, {
        slug: "reopen-aborted",
        from: "orchestrator",
        to: "po",
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
      let abortCalls = 0;
      const result = await tool.execute("1", {slug: "reopen-aborted", reason: "redo"}, controller.signal, undefined, {cwd, abort() {
        abortCalls += 1;
      }});

      assert.match(result.content[0].text, /^Task "reopen-aborted" aborted\./);
      assert.equal(abortCalls, 1);
      assert.equal(result.details?.aborted, true);
      assert.equal(result.terminate, true);
      assert.doesNotMatch(result.content[0].text, /⛔ unfolding aborted/);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("task_reopen exports the commissioner html when /unfold --debug enabled", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    try {
      createTask(cwd, {
        slug: "reopen-debug",
        from: "orchestrator",
        to: "po",
        body: "Do work",
      });
      updateTaskStatus(cwd, "reopen-debug", "finished");

      const commissionerSessionFile = join(cwd, "commissioner-reopen-session.jsonl");
      writeFileSync(commissionerSessionFile, [
        JSON.stringify({type: "session", version: 3, id: "sess-commissioner-reopen", timestamp: "2026-06-22T00:00:00.000Z", cwd}),
      ].join("\n") + "\n");

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
      const result = await tool.execute("1", {slug: "reopen-debug", reason: "redo"}, undefined, undefined, {
        cwd,
        sessionManager: { getSessionFile: () => commissionerSessionFile },
      });

      assert.equal(promptCount, 1);
      assert.match(result.content[0].text, /Outcome: finished/);
      assert.deepEqual(listExportFiles(cwd).filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-reopen-debug\.commissioner\.html$/.test(name)).length, 1);
      assert.deepEqual(listExportFiles(cwd).filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-reopen-debug\.html$/.test(name)).length, 0);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("does not export commissioner html when debug mode is off", async () => {
    const {cwd} = makeTestGitRepo("index-tools");
    try {
      createTask(cwd, {
        slug: "unblock-nodebug",
        from: "orchestrator",
        to: "po",
        body: "Do work",
      });
      updateTaskStatus(cwd, "unblock-nodebug", "blocked", "waiting");

      const commissionerSessionFile = join(cwd, "commissioner-nodebug-session.jsonl");
      writeFileSync(commissionerSessionFile, [
        JSON.stringify({type: "session", version: 3, id: "sess-commissioner-nodebug", timestamp: "2026-06-22T00:00:00.000Z", cwd}),
      ].join("\n") + "\n");

      const activeSessions = new Map<string, any>();
      activeSessions.set("unblock-nodebug", {
        isStreaming: false,
        prompt: async () => {
          updateTaskStatus(cwd, "unblock-nodebug", "finished");
        },
        getSessionStats: () => ({cost: 0, tokens: {input: 0, output: 0}}),
      });

      const {tools} = setupPi(activeSessions);
      const tool = tools.get("task_unblock");
      assert.ok(tool, "task_unblock tool must be registered");
      await tool.execute("1", {slug: "unblock-nodebug", reason: "continue"}, undefined, undefined, {
        cwd,
        sessionManager: { getSessionFile: () => commissionerSessionFile },
      });

      assert.deepEqual(listExportFiles(cwd).filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-unblock-nodebug\.commissioner\.html$/.test(name)).length, 0);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});


describe("/connect-session command", () => {
  function setupPi() {
    const commands = new Map<string, any>();
    const execCalls: Array<{cmd: string; args: string[]}> = [];
    const pi = {
      on() {},
      registerMessageRenderer() {},
      registerCommand(name: string, def: any) { commands.set(name, def); },
      registerTool() {},
      sendMessage() {},
      sendUserMessage() {},
      getAllTools() { return []; },
      getCommands() { return []; },
      async exec(cmd: string, args: string[]) {
        execCalls.push({cmd, args});
        return {code: 0};
      },
    };
    initUnfolding(pi as any);
    return {commands, execCalls};
  }

  it("shows a picker with tasks that have an existing session file", async () => {
    const {cwd} = makeTestGitRepo("connect-cmd");
    try {
      const {commands, execCalls} = setupPi();
      const poSessionFile = join(cwd, "po-session.jsonl");
      const architectSessionFile = join(cwd, "architect-session.jsonl");
      writeFileSync(poSessionFile, "");
      writeFileSync(architectSessionFile, "");
      createTask(cwd, {slug: "po-1", from: "orchestrator", to: "po", body: "Code", session_file: poSessionFile});
      createTask(cwd, {slug: "arch-1", from: "po", to: "architect", body: "Design", parent_slug: "po-1", session_file: architectSessionFile});

      const selectCalls: string[][] = [];
      const notifyCalls: string[] = [];
      const ctx = {
        cwd,
        sessionManager: {getSessionFile: () => join(cwd, "root.jsonl")},
        ui: {
          async select(_prompt: string, opts: string[]) {
            selectCalls.push(opts);
            return opts.find(option => /\[po\] po-1/.test(option));
          },
          notify(msg: string) { notifyCalls.push(msg); },
        },
      };

      await commands.get("connect-session")?.handler(undefined, ctx);

      assert.equal(selectCalls.length, 1, "picker should appear");
      assert.ok(selectCalls[0].some(option => /\[po\] po-1/.test(option)), "picker should include the PO session");
      assert.ok(selectCalls[0].some(option => /\[architect\] arch-1/.test(option)), "picker should include the Architect session");
      assert.match(selectCalls[0][selectCalls[0].length - 1], /Stay here/);
      assert.equal(execCalls.length, 0, "no tmux call expected outside tmux");
      assert.ok(notifyCalls.some(m => m.includes(poSessionFile)), "fallback notify should include chosen session file");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("shows 'No sub-sessions found' when no tasks have an existing session file", async () => {
    const {cwd} = makeTestGitRepo("connect-cmd-empty");
    try {
      const {commands} = setupPi();
      createTask(cwd, {slug: "po-1", from: "orchestrator", to: "po", body: "Code", session_file: "/nonexistent/path.jsonl"});

      const notifyCalls: Array<{msg: string; level: string}> = [];
      const ctx = {
        cwd,
        sessionManager: {getSessionFile: () => undefined},
        ui: {
          async select() { return undefined; },
          notify(msg: string, level: string) { notifyCalls.push({msg, level}); },
        },
      };

      await commands.get("connect-session")?.handler(undefined, ctx);

      assert.ok(notifyCalls.some(n => n.msg.includes("No sub-sessions")), "should notify no sessions");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("does not open tmux when user picks Stay here", async () => {
    const {cwd} = makeTestGitRepo("connect-cmd-stay");
    try {
      const {commands, execCalls} = setupPi();
      const sessionFile = join(cwd, "arch.jsonl");
      writeFileSync(sessionFile, "");
      createTask(cwd, {slug: "po-1", from: "orchestrator", to: "po", body: "Design", session_file: sessionFile});

      const ctx = {
        cwd,
        sessionManager: {getSessionFile: () => undefined},
        ui: {
          async select(_prompt: string, opts: string[]) {
            return opts[opts.length - 1]; // Stay here
          },
          notify() {},
        },
      };

      await commands.get("connect-session")?.handler(undefined, ctx);
      assert.equal(execCalls.length, 0, "tmux must not be opened for Stay here");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});
