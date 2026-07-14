import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CostLedger } from "../cost-ledger.ts";

describe("CostLedger", () => {
  it("records and retrieves a single entry", () => {
    const ledger = new CostLedger();
    ledger.record({ slug: "po-1", role: "po", status: "finished", cost: 1.23, tokens: { input: 100, output: 50 } }, false);
    assert.equal(ledger.descendantCost("po-1"), 0);
    assert.equal(ledger.grandTotal, 1.23);
    assert.equal(ledger.hasEntries, true);
  });

  it("sums transitive descendant costs", () => {
    const ledger = new CostLedger();
    ledger.record({ slug: "po-1", role: "po", parent_slug: undefined, status: "finished", cost: 1.00, tokens: { input: 0, output: 0 } }, false);
    ledger.record({ slug: "arch-1", role: "architect", parent_slug: "po-1", status: "finished", cost: 2.00, tokens: { input: 0, output: 0 } }, false);
    ledger.record({ slug: "coder-1", role: "coder", parent_slug: "arch-1", status: "finished", cost: 3.00, tokens: { input: 0, output: 0 } }, false);
    // po-1's descendants: arch-1 (2.00) + coder-1 (3.00) = 5.00
    assert.equal(ledger.descendantCost("po-1"), 5.00);
    // arch-1's descendants: coder-1 (3.00)
    assert.equal(ledger.descendantCost("arch-1"), 3.00);
    // coder-1 has no descendants
    assert.equal(ledger.descendantCost("coder-1"), 0);
    assert.equal(ledger.grandTotal, 6.00);
  });

  it("overwrites cost for same-slug block/unblock cycles (same session file)", () => {
    const ledger = new CostLedger();
    ledger.record({ slug: "po-1", role: "po", status: "blocked", cost: 0.50, tokens: { input: 0, output: 0 } }, false);
    // resumed: same session file, cost is cumulative, overwrite
    ledger.record({ slug: "po-1", role: "po", status: "finished", cost: 1.20, tokens: { input: 0, output: 0 } }, false);
    assert.equal(ledger.grandTotal, 1.20);
  });

  it("accumulates cost for recreate (new session file)", () => {
    const ledger = new CostLedger();
    // first session (aborted for recreate)
    ledger.record({ slug: "arch-1", role: "architect", status: "aborted", cost: 0.80, tokens: { input: 0, output: 0 } }, true);
    // recreated new session
    ledger.record({ slug: "arch-1", role: "architect", status: "finished", cost: 3.00, tokens: { input: 0, output: 0 } }, true);
    assert.equal(ledger.grandTotal, 3.80);
  });

  it("includes root cost in grand total", () => {
    const ledger = new CostLedger();
    ledger.addRootCost(2.50);
    ledger.record({ slug: "po-1", role: "po", status: "finished", cost: 1.00, tokens: { input: 0, output: 0 } }, false);
    assert.equal(ledger.grandTotal, 3.50);
  });

  it("ignores zero-cost root additions", () => {
    const ledger = new CostLedger();
    ledger.addRootCost(0);
    assert.equal(ledger.grandTotal, 0);
  });

  it("updates status without changing cost", () => {
    const ledger = new CostLedger();
    ledger.record({ slug: "po-1", role: "po", status: "finished", cost: 1.00, tokens: { input: 0, output: 0 } }, false);
    ledger.updateStatus("po-1", "rolled back");
    assert.equal(ledger.grandTotal, 1.00);
    const summary = ledger.renderSummary();
    assert.match(summary, /✗/);
  });

  it("renders a summary table with role, slug, marker, cost, orchestrator row, and grand total", () => {
    const ledger = new CostLedger();
    ledger.addRootCost(0.50);
    ledger.record({ slug: "po-1", role: "po", parent_slug: undefined, status: "finished", cost: 1.23, tokens: { input: 100, output: 50 } }, false);
    ledger.record({ slug: "arch-1", role: "architect", parent_slug: "po-1", status: "blocked", cost: 4.50, tokens: { input: 200, output: 80 } }, false);

    const summary = ledger.renderSummary();
    const lines = summary.split("\n");
    assert.match(lines[0], /unfolding cost summary/);
    assert.ok(lines.some(l => /po\b.*po-1.*✓.*\$1\.23/.test(l)), "po row with checkmark and cost");
    assert.ok(lines.some(l => /architect.*arch-1.*✗.*\$4\.50/.test(l)), "architect row with x and cost");
    assert.ok(lines.some(l => /orchestrator.*\s+\$0\.50/.test(l)), "orchestrator row with empty slug and no marker");
    assert.ok(lines.some(l => /grand total.*\$6\.23/.test(l)), "grand total = 0.50 + 1.23 + 4.50");
  });

  it("renders summary with empty orchestrator slug and no marker", () => {
    const ledger = new CostLedger();
    ledger.addRootCost(1.00);
    ledger.record({ slug: "po-1", role: "po", status: "finished", cost: 2.00, tokens: { input: 0, output: 0 } }, false);
    const summary = ledger.renderSummary();
    const lines = summary.split("\n");
    const orchLine = lines.find(l => l.includes("orchestrator"));
    assert.ok(orchLine, "orchestrator row exists");
    // orchestrator row should not contain a slug or marker
    assert.doesNotMatch(orchLine, /po-1|✓|✗/);
    assert.match(orchLine, /\$1\.00/);
  });

  it("orders entries top-down by delegation tree", () => {
    const ledger = new CostLedger();
    ledger.record({ slug: "coder-1", role: "coder", parent_slug: "arch-1", status: "finished", cost: 3.00, tokens: { input: 0, output: 0 } }, false);
    ledger.record({ slug: "po-1", role: "po", parent_slug: undefined, status: "finished", cost: 1.00, tokens: { input: 0, output: 0 } }, false);
    ledger.record({ slug: "arch-1", role: "architect", parent_slug: "po-1", status: "finished", cost: 2.00, tokens: { input: 0, output: 0 } }, false);

    const summary = ledger.renderSummary();
    const lines = summary.split("\n");
    const poIdx = lines.findIndex(l => /po-1/.test(l));
    const archIdx = lines.findIndex(l => /arch-1/.test(l));
    const coderIdx = lines.findIndex(l => /coder-1/.test(l));
    assert.ok(poIdx < archIdx, "po before architect");
    assert.ok(archIdx < coderIdx, "architect before coder");
  });

  it("prints summary only once until reset", () => {
    const ledger = new CostLedger();
    ledger.record({ slug: "po-1", role: "po", status: "finished", cost: 1.00, tokens: { input: 0, output: 0 } }, false);
    assert.equal(ledger.isPrinted, false);
    ledger.markPrinted();
    assert.equal(ledger.isPrinted, true);
    ledger.resetPrinted();
    assert.equal(ledger.isPrinted, false);
  });

  it("returns empty summary when no entries and no root cost", () => {
    const ledger = new CostLedger();
    assert.equal(ledger.renderSummary(), "");
  });

  it("includes rolled-back tasks in summary", () => {
    const ledger = new CostLedger();
    ledger.record({ slug: "arch-1", role: "architect", status: "rolled back", cost: 0.80, tokens: { input: 0, output: 0 } }, false);
    ledger.record({ slug: "arch-2", role: "architect", parent_slug: "po-1", status: "finished", cost: 3.00, tokens: { input: 0, output: 0 } }, false);
    ledger.record({ slug: "po-1", role: "po", parent_slug: undefined, status: "finished", cost: 1.00, tokens: { input: 0, output: 0 } }, false);

    const summary = ledger.renderSummary();
    assert.match(summary, /✗/);
    assert.match(summary, /grand total.*\$4\.80/);
  });
});
