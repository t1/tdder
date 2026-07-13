/**
 * Crash-diagnostics regression tests for the jdtls process exit handler.
 *
 * The `proc.on("exit")` handler previously reported the exit code in the slot
 * where the captured stderr belongs, so a jdtls that died emitting the real
 * reason on stderr surfaced as "... — exit code 15" and the cause was lost.
 * These tests pin the contract: the error thrown by `start()` must carry the
 * captured stderr, the exit code, and — when applicable — the killing signal.
 */

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- module mocks (hoisted above the import below) ------------------------

// Names prefixed with `mock` so vitest's hoisting allows the factory to
// reference them.
const mockSpawn = vi.fn();
const mockRequest = vi.fn();
const mockNotify = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock("node:fs", () => ({
  existsSync: () => true,
}));

// Stub the LSP transport so `start()` can sail through the initialize
// handshake and park at the readiness wait without real stdio. The crash
// path only depends on the process exit handler. The specifier must resolve
// to the same module `jdtls-server.ts` imports, hence `../lsp-transport.ts`
// (relative to this test file), not `./`.
vi.mock("../lsp-transport.ts", () => ({
  LspTransport: class {
    constructor() {}
    request = mockRequest;
    notify = mockNotify;
  },
}));

import { JdtlsServer } from "../jdtls-server.ts";

// --- helpers --------------------------------------------------------------

/** A minimal fake `ChildProcess`: an EventEmitter with stderr/stdout/stdin + kill. */
function makeFakeChild(): any {
  const child = new EventEmitter();
  (child as any).stderr = new EventEmitter(); // stderr data feeds `stderrChunks`
  (child as any).stdout = new EventEmitter();
  (child as any).stdin = { write: vi.fn() };
  (child as any).kill = vi.fn();
  return child;
}

/** Drain the microtask queue so `start()` runs past the initialize await and
 *  parks at `await readyPromise` before we emit the exit event. */
const drainMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  mockSpawn.mockReset();
  mockRequest.mockReset();
  mockNotify.mockReset();
  // initialize handshake resolves immediately so `start()` reaches the ready wait
  mockRequest.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

// --- tests ----------------------------------------------------------------

describe("JdtlsServer.start crash diagnostics", () => {
  it("includes captured stderr and the exit code when the process exits with a code", async () => {
    const server = new JdtlsServer(() => {});
    const child = makeFakeChild();
    mockSpawn.mockReturnValue(child);

    const startPromise = server.start("/proj");
    await drainMicrotasks();

    child.stderr.emit(
      "data",
      Buffer.from("java.lang.IllegalStateException: workspace locked"),
    );
    child.emit("exit", 15, null);

    const error = (await startPromise.catch((e) => e)) as Error;
    expect(error).toBeInstanceOf(Error);
    // the real reason jdtls printed — the bug previously discarded this in
    // favour of the literal string "exit code 15"
    expect(error.message).toContain("workspace locked");
    // the exit code must still be reported
    expect(error.message).toContain("exit code 15");
  });

  it("names the signal and includes captured stderr when the process is killed", async () => {
    const server = new JdtlsServer(() => {});
    const child = makeFakeChild();
    mockSpawn.mockReturnValue(child);

    const startPromise = server.start("/proj");
    await drainMicrotasks();

    child.stderr.emit("data", Buffer.from("boom-dead"));
    child.emit("exit", null, "SIGKILL");

    const error = (await startPromise.catch((e) => e)) as Error;
    expect(error).toBeInstanceOf(Error);
    // a signal death was previously misreported as "exit code null"
    expect(error.message).toContain("killed by signal SIGKILL");
    expect(error.message).toContain("boom-dead");
  });
});
