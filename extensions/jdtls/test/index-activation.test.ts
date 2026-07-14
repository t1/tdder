/**
 * Sticky activation preference — tri-state regression tests.
 *
 * `.pi/settings/jdtls.json` records the user's enable choice. The desired
 * behavior is symmetric:
 *   - absent  : ask, persist the answer, start on yes
 *   - true    : start immediately, do NOT ask again (the bug: today it re-asks)
 *   - false   : stay silent, do not ask, do not start
 *
 * The only in-band way to flip the preference is to delete/edit the settings
 * file; that is the documented escape hatch, symmetric for both true and
 * false.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Names prefixed with `mock` for vitest hoisting access.
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockJdtlsStart = vi.fn();
const mockJdtlsShutdown = vi.fn();
const mockStatusCb = { current: null as ((s: string) => void) | null };

vi.mock("node:fs", () => ({
  existsSync: (...a: unknown[]) => mockExistsSync(...a),
  readFileSync: (...a: unknown[]) => mockReadFileSync(...a),
  writeFileSync: (...a: unknown[]) => mockWriteFileSync(...a),
  mkdirSync: (...a: unknown[]) => mockMkdirSync(...a),
}));

// Stub the jdtls-server module: claim Java + jdtls present, and give back a
// JdtlsServer whose start()/shutdown() are controllable from the test. The
// status getter reflects the last value pushed through `onStatus`.
vi.mock("../jdtls-server.ts", () => ({
  isJavaProject: () => true,
  findJdtls: () => "/fake/jdtls",
  JdtlsServer: class {
    private _status = "stopped" as string;
    constructor(onStatus: (s: string) => void) {
      mockStatusCb.current = (s: string) => {
        this._status = s;
        onStatus(s);
      };
    }
    get status(): string {
      return this._status;
    }
    start = mockJdtlsStart;
    shutdown = mockJdtlsShutdown;
  },
}));

import extension from "../index.ts";

// ---------------------------------------------------------------------------
// Settings file model: `.pi/settings/jdtls.json` under the project cwd.
// ---------------------------------------------------------------------------

const PROJECT = "/proj";
const SETTINGS = `${PROJECT}/.pi/settings/jdtls.json`;

function setNoSettings(): void {
  mockExistsSync.mockImplementation((p: string) => p !== SETTINGS);
}

function setSettings(json: unknown): void {
  mockExistsSync.mockImplementation((p: string) => p === SETTINGS);
  mockReadFileSync.mockImplementation((p: string) =>
    p === SETTINGS ? JSON.stringify(json) : "",
  );
}

// ---------------------------------------------------------------------------
// Minimal pi + ctx scaffolding. Only the methods the session_start handler
// touches are implemented; the rest are unreachable for this flow.
// ---------------------------------------------------------------------------

interface CtxOpts {
  cwd?: string;
  confirmResult?: boolean;
  hasUI?: boolean;
}

function makeApi(): {
  api: ExtensionAPI;
  handlers: Map<string, (e: any, ctx: any) => any>;
  commands: Map<
    string,
    { handler: (args: string, ctx: ExtensionContext) => Promise<void> }
  >;
} {
  const handlers = new Map<string, (e: any, ctx: any) => any>();
  const commands = new Map<
    string,
    { handler: (args: string, ctx: ExtensionContext) => Promise<void> }
  >();
  const api = {
    on: (event: string, handler: (e: any, ctx: any) => any) => {
      handlers.set(event, handler);
    },
    registerCommand: (
      name: string,
      options: {
        handler: (args: string, ctx: ExtensionContext) => Promise<void>;
      },
    ) => {
      commands.set(name, options);
    },
    registerTool: vi.fn(),
    // The real setActiveTools filters by registered tools; the test only cares
    // that activation happens, so a no-op stand-in suffices.
    getAllTools: () => [],
    getActiveTools: () => [],
    setActiveTools: () => {},
  } as unknown as ExtensionAPI;
  return { api, handlers, commands };
}

function makeCtx(opts: CtxOpts = {}): ExtensionContext {
  const confirmCalls: Array<{ title: string; message: string }> = [];
  const statusCalls: Array<{ key: string; text: string | undefined }> = [];
  const notifyCalls: Array<{ message: string; type?: string }> = [];
  const ctx = {
    cwd: opts.cwd ?? PROJECT,
    mode: "tui",
    hasUI: opts.hasUI ?? true,
    ui: {
      confirm: async (title: string, message: string) => {
        confirmCalls.push({ title, message });
        return opts.confirmResult ?? true;
      },
      setStatus: (key: string, text: string | undefined) => {
        statusCalls.push({ key, text });
      },
      notify: (message: string, type?: string) => {
        notifyCalls.push({ message, type });
      },
    },
  } as unknown as ExtensionContext & {
    __confirmCalls: typeof confirmCalls;
    __statusCalls: typeof statusCalls;
    __notifyCalls: typeof notifyCalls;
  };
  (ctx as unknown as { __confirmCalls: unknown }).__confirmCalls = confirmCalls;
  (ctx as unknown as { __statusCalls: unknown }).__statusCalls = statusCalls;
  (ctx as unknown as { __notifyCalls: unknown }).__notifyCalls = notifyCalls;
  return ctx;
}

function instrumentation(ctx: ExtensionContext): {
  confirmCalls: Array<{ title: string; message: string }>;
  statusCalls: Array<{ key: string; text: string | undefined }>;
  notifyCalls: Array<{ message: string; type?: string }>;
} {
  const c = ctx as unknown as {
    __confirmCalls: Array<{ title: string; message: string }>;
    __statusCalls: Array<{ key: string; text: string | undefined }>;
    __notifyCalls: Array<{ message: string; type?: string }>;
  };
  return {
    confirmCalls: c.__confirmCalls,
    statusCalls: c.__statusCalls,
    notifyCalls: c.__notifyCalls,
  };
}

async function fireCommand(
  cmd: { handler: (args: string, ctx: ExtensionContext) => Promise<void> },
  args: string,
  ctx: ExtensionContext,
): Promise<void> {
  await cmd.handler(args, ctx);
  // start()/shutdown() may be detached; let microtasks drain.
  await new Promise<void>((r) => setTimeout(r, 0));
}

async function fireSessionStart(
  handler: (e: SessionStartEvent, ctx: ExtensionContext) => Promise<unknown>,
  ctx: ExtensionContext,
): Promise<void> {
  await handler(
    { type: "session_start", reason: "startup" } as SessionStartEvent,
    ctx,
  );
  // start() is invoked as a detached background promise; let it resolve.
  await new Promise<void>((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
  mockWriteFileSync.mockReset();
  mockMkdirSync.mockReset();
  mockJdtlsStart.mockReset();
  mockJdtlsShutdown.mockReset();
  mockStatusCb.current = null;

  // Wire the JdtlsServer stub: start() synchronously fires the status callback
  // with "starting" then "ready" and resolves. shutdown() resolves.
  mockJdtlsStart.mockImplementation(async () => {
    mockStatusCb.current?.("starting");
    mockStatusCb.current?.("ready");
  });
  mockJdtlsShutdown.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("jdtls activation preference (tri-state)", () => {
  it("asks and starts when no preference is persisted", async () => {
    setNoSettings();
    const { api, handlers } = makeApi();
    extension(api);
    const ctx = makeCtx({ confirmResult: true });
    await fireSessionStart(handlers.get("session_start")!, ctx);

    const { confirmCalls, statusCalls } = instrumentation(ctx);
    expect(confirmCalls).toHaveLength(1);
    // persisted as enabled
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      SETTINGS,
      JSON.stringify({ enabled: true }, null, 2) + "\n",
      "utf-8",
    );
    expect(mockJdtlsStart).toHaveBeenCalledTimes(1);
    expect(statusCalls.map((s) => s.text)).toContain("[jdtls ●]");
  });

  it("starts without asking when enabled=true is persisted", async () => {
    setSettings({ enabled: true });
    const { api, handlers } = makeApi();
    extension(api);
    const ctx = makeCtx({ confirmResult: false }); // confirms a stray prompt would have flipped it
    await fireSessionStart(handlers.get("session_start")!, ctx);

    const { confirmCalls, statusCalls } = instrumentation(ctx);
    // THE BUG: today no settings early-return exists for true, so it re-asks.
    expect(confirmCalls).toHaveLength(0);
    expect(mockJdtlsStart).toHaveBeenCalledTimes(1);
    expect(statusCalls.map((s) => s.text)).toContain("[jdtls ●]");
    // preference unchanged → no write (file already says true)
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("stays silent and does not start when enabled=false is persisted", async () => {
    setSettings({ enabled: false });
    const { api, handlers } = makeApi();
    extension(api);
    const ctx = makeCtx({ confirmResult: true }); // a stray prompt would re-enable
    await fireSessionStart(handlers.get("session_start")!, ctx);

    const { confirmCalls, statusCalls } = instrumentation(ctx);
    expect(confirmCalls).toHaveLength(0);
    expect(mockJdtlsStart).not.toHaveBeenCalled();
    expect(statusCalls.map((s) => s.text)).not.toContain("[jdtls ●]");
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("does not prompt, persist, or start when no UI is available (headless/child session)", async () => {
    setNoSettings();
    const { api, handlers } = makeApi();
    extension(api);
    const ctx = makeCtx({ hasUI: false });
    await fireSessionStart(handlers.get("session_start")!, ctx);

    const { confirmCalls } = instrumentation(ctx);
    // no prompt fired — ctx.ui.confirm returns false in headless sessions
    expect(confirmCalls).toHaveLength(0);
    // must NOT persist a choice — leave the setting absent for the next interactive session
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockJdtlsStart).not.toHaveBeenCalled();
  });
});

describe("/jdtls command", () => {
  it("is registered with start, stop, status, ask subcommands", () => {
    setNoSettings();
    const { api, commands } = makeApi();
    extension(api);
    expect(commands.has("jdtls")).toBe(true);
  });

  it("status reports stopped when no server is running", async () => {
    setNoSettings();
    const { api, commands } = makeApi();
    extension(api);
    const ctx = makeCtx();
    await fireCommand(commands.get("jdtls")!, "status", ctx);

    const { notifyCalls } = instrumentation(ctx);
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0]?.message).toMatch(/not running|stopped/i);
  });

  it("start launches the server and reports ready", async () => {
    setNoSettings();
    const { api, commands } = makeApi();
    extension(api);
    const ctx = makeCtx();
    await fireCommand(commands.get("jdtls")!, "start", ctx);

    const { notifyCalls, statusCalls } = instrumentation(ctx);
    expect(mockJdtlsStart).toHaveBeenCalledTimes(1);
    expect(statusCalls.map((s) => s.text)).toContain("[jdtls ●]");
    expect(notifyCalls.some((n) => /start/i.test(n.message))).toBe(true);
  });

  it("start is a no-op (no double-start) when already running", async () => {
    setNoSettings();
    const { api, commands } = makeApi();
    extension(api);
    const ctx = makeCtx();
    await fireCommand(commands.get("jdtls")!, "start", ctx);
    await fireCommand(commands.get("jdtls")!, "start", ctx);

    expect(mockJdtlsStart).toHaveBeenCalledTimes(1);
  });

  it("stop shuts down a running server", async () => {
    setNoSettings();
    const { api, commands } = makeApi();
    extension(api);
    const ctx = makeCtx();
    await fireCommand(commands.get("jdtls")!, "start", ctx);
    await fireCommand(commands.get("jdtls")!, "stop", ctx);

    const { notifyCalls, statusCalls } = instrumentation(ctx);
    expect(mockJdtlsShutdown).toHaveBeenCalledTimes(1);
    expect(statusCalls.some((s) => s.text === undefined)).toBe(true);
    expect(notifyCalls.some((n) => /stop/i.test(n.message))).toBe(true);
  });

  it("stop is a safe no-op when nothing is running", async () => {
    setNoSettings();
    const { api, commands } = makeApi();
    extension(api);
    const ctx = makeCtx();
    await fireCommand(commands.get("jdtls")!, "stop", ctx);

    const { notifyCalls } = instrumentation(ctx);
    expect(mockJdtlsShutdown).not.toHaveBeenCalled();
    expect(
      notifyCalls.some((n) => /not running|nothing/i.test(n.message)),
    ).toBe(true);
  });

  it("ask re-prompts and, on yes, starts (or keeps running) and persists true", async () => {
    setNoSettings();
    const { api, commands } = makeApi();
    extension(api);
    const ctx = makeCtx({ confirmResult: true });
    await fireCommand(commands.get("jdtls")!, "ask", ctx);

    const { confirmCalls, statusCalls } = instrumentation(ctx);
    expect(confirmCalls).toHaveLength(1);
    expect(mockJdtlsStart).toHaveBeenCalledTimes(1);
    expect(statusCalls.map((s) => s.text)).toContain("[jdtls ●]");
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      SETTINGS,
      JSON.stringify({ enabled: true }, null, 2) + "\n",
      "utf-8",
    );
  });

  it("ask re-prompts even when enabled=false is persisted (the escape hatch)", async () => {
    setSettings({ enabled: false });
    const { api, commands } = makeApi();
    extension(api);
    const ctx = makeCtx({ confirmResult: true });
    await fireCommand(commands.get("jdtls")!, "ask", ctx);

    const { confirmCalls } = instrumentation(ctx);
    expect(confirmCalls).toHaveLength(1);
    expect(mockJdtlsStart).toHaveBeenCalledTimes(1);
  });

  it("ask on 'no' stops a running server and persists false", async () => {
    setSettings({ enabled: true });
    const { api, handlers, commands } = makeApi();
    extension(api);
    const ctx = makeCtx({ confirmResult: false });
    // First, get a server running via session_start (enabled=true → silent start).
    await fireSessionStart(handlers.get("session_start")!, ctx);
    expect(mockJdtlsStart).toHaveBeenCalledTimes(1);
    mockJdtlsStart.mockClear();

    await fireCommand(commands.get("jdtls")!, "ask", ctx);

    const { confirmCalls, statusCalls } = instrumentation(ctx);
    expect(confirmCalls).toHaveLength(1);
    expect(mockJdtlsShutdown).toHaveBeenCalledTimes(1);
    expect(statusCalls.some((s) => s.text === undefined)).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      SETTINGS,
      JSON.stringify({ enabled: false }, null, 2) + "\n",
      "utf-8",
    );
    // must NOT have (re)started
    expect(mockJdtlsStart).not.toHaveBeenCalled();
  });

  it("no/unknown subcommand prints usage", async () => {
    setNoSettings();
    const { api, commands } = makeApi();
    extension(api);
    const ctx = makeCtx();
    await fireCommand(commands.get("jdtls")!, "", ctx);
    await fireCommand(commands.get("jdtls")!, "bogus", ctx);

    const { notifyCalls } = instrumentation(ctx);
    expect(notifyCalls.filter((n) => /usage/i.test(n.message))).toHaveLength(2);
  });
});
