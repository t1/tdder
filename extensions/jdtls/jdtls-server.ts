/**
 * jdtls process lifecycle — detection, spawn, LSP handshake, shutdown.
 *
 * Keeps the transport layer (lsp-transport.ts) separate from process management.
 * Phase 4 will add document-open tracking and diagnostics on top of this.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LspTransport } from "./lsp-transport.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const READY_TIMEOUT_MS = 60_000; // cold start observed ~14 s; 60 s is generous
const SHUTDOWN_TIMEOUT_MS = 5_000;

/** Concatenate captured stderr chunks into a `"\nstderr: <text>"` tail, or `""`. */
function stderrTail(chunks: readonly Buffer[]): string {
  return chunks.length ? `\nstderr: ${Buffer.concat(chunks).toString()}` : "";
}

// ---------------------------------------------------------------------------
// Project & executable detection (pure — easy to test)
// ---------------------------------------------------------------------------

/** True when `cwd` looks like a Java project. */
export function isJavaProject(cwd: string): boolean {
  return ["pom.xml", "build.gradle", "build.gradle.kts"].some((f) =>
    existsSync(join(cwd, f)),
  );
}

/**
 * Candidate paths checked in priority order:
 *  1. `$JDTLS_HOME/bin/jdtls`
 *  2. `/opt/homebrew/bin/jdtls`   (Homebrew, Apple Silicon)
 *  3. `/usr/local/bin/jdtls`      (Homebrew, Intel)
 *  4. `~/.local/share/nvim/mason/bin/jdtls`  (Mason / Neovim)
 */
export function findJdtls(): string | null {
  const home = process.env["JDTLS_HOME"];
  if (home) {
    const bin = join(home, "bin", "jdtls");
    if (existsSync(bin)) return bin;
  }
  const candidates = [
    "/opt/homebrew/bin/jdtls",
    "/usr/local/bin/jdtls",
    join(homedir(), ".local", "share", "nvim", "mason", "bin", "jdtls"),
  ];
  return candidates.find(existsSync) ?? null;
}

// ---------------------------------------------------------------------------
// Server status
// ---------------------------------------------------------------------------

export type ServerStatus = "stopped" | "starting" | "ready" | "error";

// ---------------------------------------------------------------------------
// JdtlsServer
// ---------------------------------------------------------------------------

/**
 * Manages one jdtls child process:
 * - start(cwd)   — detect exe, spawn, handshake, wait for ready
 * - shutdown()   — graceful LSP shutdown + exit + kill fallback
 * - request()    — forward to transport (throws if not ready)
 * - notify()     — forward to transport (throws if not started)
 *
 * `onStatusChange` is called whenever the status transitions.
 * `onNotification` (optional) is called for every server-push notification;
 *  Phase 4 will use this to collect diagnostics.
 */
export class JdtlsServer {
  private proc: ChildProcess | null = null;
  private transport: LspTransport | null = null;
  private _status: ServerStatus = "stopped";
  private readyResolve: (() => void) | null = null;
  private readyReject: ((e: Error) => void) | null = null;
  private readonly notifListeners = new Set<(method: string, params: unknown) => void>();
  private readonly openDocs = new Set<string>();
  private _serviceReady = false;

  constructor(
    private readonly onStatusChange: (status: ServerStatus) => void,
  ) {}

  get status(): ServerStatus {
    return this._status;
  }

  /**
   * True once jdtls sends `language/status {type:"ServiceReady"}`.
   * workspace/symbol returns 0 results before this point.
   */
  get serviceReady(): boolean {
    return this._serviceReady;
  }

  /** True if the given URI has been opened via didOpen and not yet closed. */
  isDocOpen(uri: string): boolean {
    return this.openDocs.has(uri);
  }

  /**
   * Subscribe to all server-push notifications (diagnostics, progress, …).
   * Returns an unsubscribe function — call it when the subscription is no longer needed.
   */
  addNotificationListener(fn: (method: string, params: unknown) => void): () => void {
    this.notifListeners.add(fn);
    return () => this.notifListeners.delete(fn);
  }

  // -------------------------------------------------------------------------
  // start
  // -------------------------------------------------------------------------

  async start(cwd: string): Promise<void> {
    if (this._status !== "stopped") return; // already running or starting

    const exe = findJdtls();
    if (!exe) {
      this.transition("error");
      throw new Error("jdtls not found — install via Homebrew, Mason, or set JDTLS_HOME");
    }

    this.transition("starting");

    const proc = spawn(exe, [], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
    });
    this.proc = proc;

    // Collect stderr for diagnostic use on startup failure.
    const stderrChunks: Buffer[] = [];
    proc.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on("error", () => {
      this.handleCrash(stderrTail(stderrChunks) || undefined);
    });
    proc.on("exit", (code, signal) => {
      if (this._status !== "stopped") {
        const reason =
          (signal ? `killed by signal ${signal}` : `exit code ${code}`) +
          stderrTail(stderrChunks);
        this.handleCrash(reason);
      }
    });

    // Set up readiness promise before creating the transport so that
    // any early notifications are not missed.
    const readyPromise = new Promise<void>((res, rej) => {
      this.readyResolve = res;
      this.readyReject = rej;
    });

    this.transport = new LspTransport(
      proc.stdout!,
      proc.stdin!,
      (method, params) => this.handleNotification(method, params),
      10_000, // LSP handshake timeout
    );

    // LSP handshake — initialize request (fast, ~1 s)
    await this.transport.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(cwd).toString(),
      capabilities: {
        workspace: {
          applyEdit: true,
          symbol: { dynamicRegistration: false },
        },
        textDocument: {
          synchronization: { dynamicRegistration: false },
          hover: { contentFormat: ["markdown", "plaintext"] },
          publishDiagnostics: { relatedInformation: true },
          rename: { dynamicRegistration: false },
          formatting: { dynamicRegistration: false },
        },
      },
      initializationOptions: {},
    });

    // Notify the server we are ready to receive requests.
    this.transport.notify("initialized", {});

    // Wait for jdtls to finish indexing (~14 s cold, much less warm).
    const readyTimer = setTimeout(() => {
      const stderr = stderrChunks.length
        ? `\nstderr: ${Buffer.concat(stderrChunks).toString()}`
        : "";
      this.readyReject?.(
        new Error(`jdtls did not become ready within ${READY_TIMEOUT_MS / 1000} s${stderr}`),
      );
    }, READY_TIMEOUT_MS);

    try {
      await readyPromise;
      this.transition("ready");
    } catch (err) {
      this.transition("error");
      throw err;
    } finally {
      clearTimeout(readyTimer);
      this.readyResolve = null;
      this.readyReject = null;
    }
  }

  // -------------------------------------------------------------------------
  // shutdown
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Document lifecycle helpers
  // -------------------------------------------------------------------------

  /**
   * Send textDocument/didOpen if the file isn't already tracked as open.
   * `languageId` defaults to "java".
   */
  didOpen(uri: string, text: string, languageId = "java"): void {
    if (this.openDocs.has(uri)) return;
    this.openDocs.add(uri);
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
  }

  /** Send textDocument/didClose if the file is currently tracked as open. */
  didClose(uri: string): void {
    if (!this.openDocs.has(uri)) return;
    this.openDocs.delete(uri);
    this.notify("textDocument/didClose", { textDocument: { uri } });
  }

  // -------------------------------------------------------------------------
  // Shutdown
  // -------------------------------------------------------------------------

  async shutdown(): Promise<void> {
    if (!this.proc && !this.transport) return;

    // Mark stopped first so the exit handler doesn't flip us to 'error'.
    this.transition("stopped");
    this.openDocs.clear();
    this._serviceReady = false;

    if (this.transport) {
      try {
        await Promise.race([
          this.transport.request("shutdown", null),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("shutdown timeout")), SHUTDOWN_TIMEOUT_MS),
          ),
        ]);
      } catch {
        // best-effort — still send exit
      }
      try {
        this.transport.notify("exit", undefined);
      } catch {
        // best-effort
      }
      this.transport = null;
    }

    this.proc?.kill();
    this.proc = null;
  }

  // -------------------------------------------------------------------------
  // Forward to transport
  // -------------------------------------------------------------------------

  request(method: string, params: unknown): Promise<unknown> {
    if (!this.transport) throw new Error("jdtls not started");
    return this.transport.request(method, params);
  }

  notify(method: string, params: unknown): void {
    if (!this.transport) throw new Error("jdtls not started");
    this.transport.notify(method, params);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private transition(next: ServerStatus): void {
    this._status = next;
    this.onStatusChange(next);
  }

  private handleCrash(stderr?: string): void {
    this.readyReject?.(
      new Error(`jdtls process crashed during startup${stderr ? ` — ${stderr}` : ""}`),
    );
    this.readyResolve = null;
    this.readyReject = null;
    this.proc = null;
    this.transport = null;
    if (this._status !== "stopped") this.transition("error");
  }

  private handleNotification(method: string, params: unknown): void {
    // Resolve the startup readiness promise when jdtls signals it is ready.
    if (method === "language/status") {
      const type = (params as { type?: string } | null)?.type;
      if (type === "ServiceReady") this._serviceReady = true;
      if (type === "Started" || type === "ServiceReady") {
        this.readyResolve?.();
      }
    }

    // Forward to all registered listeners (diagnostics, progress, …).
    for (const fn of this.notifListeners) fn(method, params);
  }
}
