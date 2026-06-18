import { describe, it, before, after } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { makeTestTempDir } from "./test-temp.ts";

const REQUESTY_EXTENSION = resolve("/Users/rdohna/.pi/agent/git/github.com/requestyai/pi-requesty/requesty.js");
const TDDS_ROOT = resolve(new URL("../../..", import.meta.url).pathname);
const EXTENSIONS = [
  REQUESTY_EXTENSION,
  join(TDDS_ROOT, "extensions", "hygiene"),
  join(TDDS_ROOT, "extensions", "mlx"),
  join(TDDS_ROOT, "extensions", "unfolding"),
];
const DEFAULT_TIMEOUT_MS = Number(process.env.UNFOLDING_REAL_TIMEOUT_MS ?? "120000");

interface RpcEvent {
  type: string;
  [key: string]: unknown;
}

interface ModelRef {
  provider: string;
  id: string;
}

interface RunSummary {
  requestedModel?: string;
  selectedModel?: ModelRef;
  rootSessionFile?: string;
  childSessionFiles: string[];
  childModels: ModelRef[];
  artifacts: string[];
  taskFiles: string[];
}

function parseArgs(): { model?: string } {
  return { model: process.env.UNFOLDING_TEST_MODEL };
}

function parseQualifiedModel(value: string): ModelRef {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) {
    throw new Error(`Expected model in provider/modelId form, got: ${value}`);
  }
  return { provider: value.slice(0, slash), id: value.slice(slash + 1) };
}

function startPi(cwd: string): {
  proc: ChildProcess;
  send: (cmd: object) => void;
  nextEvent: () => Promise<RpcEvent>;
  stop: () => Promise<void>;
} {
  const args = ["--mode", "rpc", "--no-extensions"];
  for (const extension of EXTENSIONS) {
    args.push("--extension", extension);
  }

  const proc = spawn("pi", args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "Unfolding Test",
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "unfolding-test@example.com",
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? "Unfolding Test",
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? "unfolding-test@example.com",
    },
  });

  let stderr = "";
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  function send(cmd: object): void {
    proc.stdin?.write(JSON.stringify(cmd) + "\n");
  }

  const queue: RpcEvent[] = [];
  const waiters: Array<(event: RpcEvent) => void> = [];
  let buffer = "";

  proc.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = JSON.parse(trimmed) as RpcEvent;
      const waiter = waiters.shift();
      if (waiter) waiter(event);
      else queue.push(event);
    }
  });

  let resolveExit: (() => void) | undefined;
  const exitPromise = new Promise<void>(resolve => {
    resolveExit = resolve;
  });

  proc.on("exit", (code, signal) => {
    const exitEvent = { type: "__process_exit__", code, signal, stderr } satisfies RpcEvent;
    const waiter = waiters.shift();
    if (waiter) waiter(exitEvent);
    else queue.push(exitEvent);
    resolveExit?.();
  });

  function nextEvent(): Promise<RpcEvent> {
    if (queue.length > 0) return Promise.resolve(queue.shift()!);
    return new Promise(resolve => waiters.push(resolve));
  }

  async function stop(): Promise<void> {
    if (proc.exitCode !== null) {
      await exitPromise;
      return;
    }

    try {
      send({ type: "abort" });
    } catch {
      // ignore broken pipe / closed stdin during shutdown
    }
    proc.stdin?.end();
    await Promise.race([exitPromise, sleep(500)]);

    if (proc.exitCode === null) proc.kill("SIGTERM");
    await Promise.race([exitPromise, sleep(500)]);

    if (proc.exitCode === null) proc.kill("SIGKILL");
    await exitPromise;
    proc.stdout?.destroy();
    proc.stderr?.destroy();
  }

  return { proc, send, nextEvent, stop };
}

async function waitFor(
  nextEvent: () => Promise<RpcEvent>,
  predicate: (event: RpcEvent) => boolean,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<RpcEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const event = await Promise.race([
      nextEvent(),
      new Promise<null>(resolve => {
        timeoutHandle = setTimeout(() => resolve(null), remaining);
      }),
    ]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (event === null) break;
    if (event.type === "__process_exit__") {
      throw new Error(`pi exited unexpectedly: ${JSON.stringify(event)}`);
    }
    if (predicate(event)) return event;
  }
  throw new Error(`Timed out waiting for event matching predicate within ${timeoutMs}ms`);
}

async function waitForResponse(
  send: (cmd: object) => void,
  nextEvent: () => Promise<RpcEvent>,
  request: object,
  id: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<RpcEvent> {
  send({ id, ...request });
  return waitFor(
    nextEvent,
    event => event.type === "response" && event.id === id,
    timeoutMs,
  );
}

function listRelativeFiles(cwd: string, directory: string): string[] {
  const path = join(cwd, directory);
  if (!existsSync(path)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) {
      for (const nested of listRelativeFiles(cwd, join(directory, entry.name))) files.push(nested);
    } else {
      files.push(join(directory, entry.name));
    }
  }
  return files.sort();
}

async function waitForArtifacts(cwd: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hasProduct = existsSync(join(cwd, "docs", "product.md"));
    const hasAtOrRule = listRelativeFiles(cwd, "docs/ats").some(path => path.endsWith(".feature"))
      || listRelativeFiles(cwd, "docs/rules").some(path => path.endsWith(".feature") || path.endsWith(".rule"));
    if (hasProduct && hasAtOrRule) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for unfolding artifacts in ${cwd}`);
}

function readModelChanges(sessionFile?: string): ModelRef[] {
  if (!sessionFile || !existsSync(sessionFile)) return [];
  const lines = readFileSync(sessionFile, "utf8").split("\n").filter(Boolean);
  return lines
    .map(line => JSON.parse(line) as RpcEvent)
    .filter(event => event.type === "model_change")
    .map(event => ({
      provider: String(event.provider),
      id: String(event.modelId),
    }));
}

function readChildSessionFiles(cwd: string): string[] {
  return listRelativeFiles(cwd, ".pi/unfolding/tasks")
    .filter(path => path.endsWith(".yaml"))
    .map(path => readFileSync(join(cwd, path), "utf8"))
    .flatMap(content => Array.from(content.matchAll(/^session_file: (.+)$/gm)).map(match => match[1]))
    .sort();
}

function summarizeRun(cwd: string, requestedModel: string | undefined, selectedModel: ModelRef | undefined, rootSessionFile: string | undefined): RunSummary {
  const childSessionFiles = readChildSessionFiles(cwd);
  const childModels = childSessionFiles.flatMap(readModelChanges);
  return {
    requestedModel,
    selectedModel,
    rootSessionFile,
    childSessionFiles,
    childModels,
    artifacts: listRelativeFiles(cwd, "docs"),
    taskFiles: listRelativeFiles(cwd, ".pi/unfolding/tasks"),
  };
}

const { model: requestedModel } = parseArgs();

describe("real unfolding smoke", { timeout: DEFAULT_TIMEOUT_MS + 30_000 }, () => {
  let cwd: string;

  before(() => {
    cwd = makeTestTempDir("unfolding-real");
  });

  after(() => {
    // Keep temp workspaces for inspection; `npm --prefix extensions/unfolding run clean` removes them.
  });

  it(`runs /unfold in a fresh temp dir${requestedModel ? ` with ${requestedModel}` : " using the default model"}`, async () => {
    console.log(`[unfolding smoke] temp dir: ${cwd}`);
    const instance = startPi(cwd);
    try {
      const ready = await waitForResponse(instance.send, instance.nextEvent, { type: "get_state" }, "state-ready", 10_000);
      const initialData = (ready as { data?: { sessionFile?: string } }).data;
      const rootSessionFile = initialData?.sessionFile;

      let selectedModel: ModelRef | undefined;
      if (requestedModel) {
        const target = parseQualifiedModel(requestedModel);
        const response = await waitForResponse(
          instance.send,
          instance.nextEvent,
          { type: "set_model", provider: target.provider, modelId: target.id },
          "set-model",
          60_000,
        );
        const modelResponse = response as { success?: boolean; error?: string; data?: { provider?: string; id?: string } };
        if (modelResponse.success === false) {
          throw new Error(`Failed to set requested model ${requestedModel}: ${modelResponse.error ?? "unknown error"}`);
        }
        const data = modelResponse.data;
        selectedModel = data?.provider && data?.id ? { provider: data.provider, id: data.id } : target;
      } else {
        const state = await waitForResponse(instance.send, instance.nextEvent, { type: "get_state" }, "state-default", 10_000);
        const model = (state as { data?: { model?: { provider?: string; id?: string } } }).data?.model;
        if (model?.provider && model?.id) selectedModel = { provider: model.provider, id: model.id };
      }

      instance.send({ id: "unfold", type: "prompt", message: "/unfold todo webapp" });
      await waitFor(instance.nextEvent, event => event.type === "response" && event.id === "unfold", 10_000);
      await waitFor(instance.nextEvent, event => event.type === "agent_start", 30_000);
      await waitForArtifacts(cwd, DEFAULT_TIMEOUT_MS);

      const summary = summarizeRun(cwd, requestedModel, selectedModel, rootSessionFile);
      writeFileSync(join(cwd, "unfold-result.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
      console.log(JSON.stringify(summary, null, 2));

      assert.ok(summary.artifacts.includes("docs/product.md"), "expected docs/product.md to be created");
      assert.ok(
        summary.artifacts.some(path => path.startsWith("docs/ats/") && path.endsWith(".feature"))
          || summary.artifacts.some(path => path.startsWith("docs/rules/") && (path.endsWith(".feature") || path.endsWith(".rule"))),
        `expected acceptance-test or rule artifacts, got: ${summary.artifacts.join(", ")}`,
      );
      assert.ok(summary.childSessionFiles.length > 0, "expected at least one child session file");
      if (summary.selectedModel) {
        assert.ok(
          summary.childModels.some(model => model.provider === summary.selectedModel?.provider && model.id === summary.selectedModel?.id),
          `expected a child session to use ${summary.selectedModel.provider}/${summary.selectedModel.id}; child models: ${summary.childModels.map(model => `${model.provider}/${model.id}`).join(", ")}`,
        );
      }
    } finally {
      await instance.stop();
    }
  });
});
