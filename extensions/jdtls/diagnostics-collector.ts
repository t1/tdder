/**
 * Quiet-period collector for textDocument/publishDiagnostics notifications.
 *
 * jdtls pushes diagnostics as unsolicited notifications — it may send several
 * bursts as it processes imports and resolves types.  We collect everything
 * that arrives and resolve only after `quietMs` of silence.
 *
 * See also: formatDiagnostics — formats the collected map into LLM-readable text.
 */

// ---------------------------------------------------------------------------
// LSP types (subset we care about)
// ---------------------------------------------------------------------------

export interface LspPosition {
  line: number;       // 0-based
  character: number;  // 0-based
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspDiagnostic {
  range: LspRange;
  severity?: 1 | 2 | 3 | 4; // 1=error 2=warning 3=info 4=hint
  message: string;
  source?: string;
}

// ---------------------------------------------------------------------------
// DiagnosticsCollector
// ---------------------------------------------------------------------------

/**
 * Collects publishDiagnostics notifications; resolves after `quietMs` silence.
 *
 * Usage:
 *   const collector = new DiagnosticsCollector(2000);
 *   const unsub = server.addNotificationListener((method, params) => {
 *     if (method === "textDocument/publishDiagnostics") {
 *       const { uri, diagnostics } = params as PublishDiagnosticsParams;
 *       collector.feed(uri, diagnostics);
 *     }
 *   });
 *   const result = await collector.promise;
 *   unsub();
 */
export class DiagnosticsCollector {
  private readonly map = new Map<string, LspDiagnostic[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private settled = false;
  private resolvePromise!: (value: Map<string, LspDiagnostic[]>) => void;

  readonly promise: Promise<Map<string, LspDiagnostic[]>>;

  constructor(private readonly quietMs: number) {
    this.promise = new Promise((resolve) => {
      this.resolvePromise = resolve;
    });
    this.scheduleSettle();
  }

  /**
   * Record diagnostics for a URI and reset the quiet-period timer.
   * Called once per publishDiagnostics notification.
   */
  feed(uri: string, diagnostics: LspDiagnostic[]): void {
    if (this.settled) return;
    this.map.set(uri, diagnostics);
    this.scheduleSettle();
  }

  /** Force immediate resolution (e.g. on error or server crash). */
  settle(): void {
    if (this.settled) return;
    this.settled = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.resolvePromise(this.map);
  }

  private scheduleSettle(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.settle(), this.quietMs);
  }
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

const SEVERITY_LABEL: Record<number, string> = {
  1: "error",
  2: "warning",
  3: "info",
  4: "hint",
};

function severityLabel(s: number | undefined): string {
  return SEVERITY_LABEL[s ?? 1] ?? "error";
}

/** Convert a 0-based LSP line/char to a 1-based "line:col" display string. */
function pos(p: LspPosition): string {
  return `${p.line + 1}:${p.character + 1}`;
}

/**
 * Format collected diagnostics as human-readable text for the LLM.
 *
 * Includes only diagnostics for `fileUri` and for the empty-string URI
 * (project-level diagnostics such as JRE mismatch).
 */
export function formatDiagnostics(
  fileUri: string,
  filePath: string,
  collected: Map<string, LspDiagnostic[]>,
): string {
  const fileDiags = collected.get(fileUri) ?? [];
  const projectDiags = collected.get("") ?? [];

  const lines: string[] = [];

  // File-level section
  if (fileDiags.length === 0) {
    lines.push(`${filePath} — no problems`);
  } else {
    lines.push(`${filePath} — ${countLabel(fileDiags)}`);
    lines.push("");
    for (const d of fileDiags) {
      const label = severityLabel(d.severity).padEnd(7);
      lines.push(`  ${pos(d.range.start).padEnd(8)} ${label}  ${d.message}`);
    }
  }

  // Project-level section (empty URI)
  if (projectDiags.length > 0) {
    lines.push("");
    lines.push(`Project diagnostics — ${countLabel(projectDiags)}`);
    lines.push("");
    for (const d of projectDiags) {
      lines.push(`  ${severityLabel(d.severity).padEnd(7)}  ${d.message}`);
    }
  }

  return lines.join("\n");
}

function countLabel(diags: LspDiagnostic[]): string {
  const errors = diags.filter((d) => (d.severity ?? 1) === 1).length;
  const warnings = diags.filter((d) => d.severity === 2).length;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors > 1 ? "s" : ""}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings > 1 ? "s" : ""}`);
  if (parts.length === 0) {
    const n = diags.length;
    parts.push(`${n} info/hint${n > 1 ? "s" : ""}`);
  }
  return parts.join(", ");
}
