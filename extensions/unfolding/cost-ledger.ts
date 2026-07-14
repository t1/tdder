/**
 * In-memory cost ledger for the Unfolding Specs workflow.
 *
 * Records the final cost of each delegated sub-session when it ends, so that:
 *  - a parent's total line can show `(+ $X)` = sum of finished descendant costs
 *  - a final summary table can be printed when the orchestrator stops
 *
 * The ledger is created once in the root extension instance and shared by
 * reference through the task-delegation tool chain (same pattern as
 * `activeSessions`).  Child extension instances create their own (unused)
 * ledgers; only the root's ledger accumulates delegated costs because the
 * shared reference is threaded through `startChildSession` / `resumeDelegatedTask`.
 *
 * Root (orchestrator) cost is accumulated from `message_end` events on the
 * root `ExtensionAPI` — each child session has its own `ExtensionRunner`, so
 * root handlers never fire for child messages (no double-counting).
 */

export type CostEntryStatus = "finished" | "blocked" | "rolled back" | "aborted";

export interface CostEntry {
  slug: string;
  role: string;
  parent_slug?: string;
  status: CostEntryStatus;
  cost: number;
  tokens: { input: number; output: number };
}

export interface SessionCostSnapshot {
  cost: number;
  tokens: { input: number; output: number };
}

export class CostLedger {
  private entries: CostEntry[] = [];
  private rootCost = 0;
  private summaryPrinted = false;

  /**
   * Record (or update) a session's final cost.
   *
   * `accumulate` should be true when the session file is new for an existing
   * slug (i.e. recreation), so the old session's cost is preserved and added
   * to the new session's cost.  For block/unblock cycles the same session
   * file continues, so `getSessionStats()` is already cumulative and
   * `accumulate = false` (overwrite) avoids double-counting.
   */
  record(entry: CostEntry, accumulate: boolean): void {
    const existing = this.entries.find(e => e.slug === entry.slug);
    if (existing && accumulate) {
      existing.cost += entry.cost;
      existing.tokens.input += entry.tokens.input;
      existing.tokens.output += entry.tokens.output;
      existing.status = entry.status;
      existing.parent_slug = entry.parent_slug ?? existing.parent_slug;
    } else if (existing) {
      existing.cost = entry.cost;
      existing.tokens = { input: entry.tokens.input, output: entry.tokens.output };
      existing.status = entry.status;
      existing.parent_slug = entry.parent_slug ?? existing.parent_slug;
    } else {
      this.entries.push({
        slug: entry.slug,
        role: entry.role,
        parent_slug: entry.parent_slug,
        status: entry.status,
        cost: entry.cost,
        tokens: { input: entry.tokens.input, output: entry.tokens.output },
      });
    }
  }

  /** Update only the status of an existing entry (e.g. mark as rolled back). */
  updateStatus(slug: string, status: CostEntryStatus): void {
    const existing = this.entries.find(e => e.slug === slug);
    if (existing) existing.status = status;
  }

  /** Accumulate root (orchestrator) cost from per-message usage. */
  addRootCost(cost: number): void {
    if (cost > 0) this.rootCost += cost;
  }

  /**
   * Sum the cost of all descendant entries (transitive) for the given slug.
   * Used for the `(+ $X)` suffix on a parent's total line.
   */
  descendantCost(slug: string): number {
    let total = 0;
    for (const entry of this.entries) {
      if (entry.parent_slug === slug) {
        total += entry.cost;
        total += this.descendantCost(entry.slug);
      }
    }
    return total;
  }

  get hasEntries(): boolean {
    return this.entries.length > 0;
  }

  get isPrinted(): boolean {
    return this.summaryPrinted;
  }

  markPrinted(): void {
    this.summaryPrinted = true;
  }

  resetPrinted(): void {
    this.summaryPrinted = false;
  }

  /** Grand total = orchestrator + all delegated sessions. */
  get grandTotal(): number {
    return this.rootCost + this.entries.reduce((sum, e) => sum + e.cost, 0);
  }

  /**
   * Render the summary table: one row per delegated session (role, slug,
   * outcome marker, cost), then the orchestrator row (empty slug), then the
   * grand total.  Entries are ordered top-down by delegation tree.
   */
  renderSummary(): string {
    if (this.entries.length === 0 && this.rootCost === 0) return "";

    const ordered = this.sortedEntries();
    const rows: Array<{ role: string; slug: string; marker: string; cost: string }> = ordered.map(e => ({
      role: e.role,
      slug: e.slug,
      marker: e.status === "finished" ? "✓" : "✗",
      cost: formatCost(e.cost),
    }));
    rows.push({ role: "orchestrator", slug: "", marker: "", cost: formatCost(this.rootCost) });

    const roleW = Math.max("role".length, ...rows.map(r => r.role.length));
    const slugW = Math.max("slug".length, ...rows.map(r => r.slug.length));
    const costW = Math.max("cost".length, ...rows.map(r => r.cost.length));

    const pad = (s: string, w: number) => s.padEnd(w);
    const padCost = (s: string, w: number) => s.padStart(w);
    const sep = "─".repeat(roleW + slugW + costW + 8);

    const header = `${pad("role", roleW)}  ${pad("slug", slugW)}    ${padCost("cost", costW)}`;
    const body = rows.map(r => `${pad(r.role, roleW)}  ${pad(r.slug, slugW)} ${r.marker} ${padCost(r.cost, costW)}`);
    const totalLabel = "grand total";
    const totalPrefix = totalLabel.padEnd(roleW + slugW + 6);
    const totalLine = `${totalPrefix}  ${padCost(formatCost(this.grandTotal), costW)}`;

    return ["unfolding cost summary", "", header, sep, ...body, sep, totalLine].join("\n");
  }

  /** Order entries top-down: root delegates first, then their children, etc. */
  private sortedEntries(): CostEntry[] {
    const byParent = new Map<string | undefined, CostEntry[]>();
    for (const entry of this.entries) {
      const key = entry.parent_slug;
      const children = byParent.get(key) ?? [];
      children.push(entry);
      byParent.set(key, children);
    }
    const ordered: CostEntry[] = [];
    const visit = (parentSlug: string | undefined): void => {
      for (const child of byParent.get(parentSlug) ?? []) {
        ordered.push(child);
        visit(child.slug);
      }
    };
    visit(undefined);
    // Include any orphans (parent slug not in ledger) at the end
    for (const entry of this.entries) {
      if (!ordered.includes(entry)) ordered.push(entry);
    }
    return ordered;
  }
}

export function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}
