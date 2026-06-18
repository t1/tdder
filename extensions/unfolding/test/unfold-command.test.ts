/**
 * Tests for the /unfold command helpers and structural invariants.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";

// ---------------------------------------------------------------------------
// Helpers extracted for testing — import directly from the module under test
// ---------------------------------------------------------------------------

import {
  stripFrontmatter,
  buildUnfoldMessage,
} from "../unfold-helpers.ts";

// ---------------------------------------------------------------------------
// stripFrontmatter
// ---------------------------------------------------------------------------

describe("stripFrontmatter", () => {
  it("removes YAML frontmatter block and returns trimmed body", () => {
    const input = `---
name: my-skill
description: does things
---

# My Skill

Some content here.`;
    assert.equal(stripFrontmatter(input), "# My Skill\n\nSome content here.");
  });

  it("returns the content unchanged when no frontmatter is present", () => {
    const input = "# Just a heading\n\nSome text.";
    assert.equal(stripFrontmatter(input), input);
  });

  it("handles a file with only frontmatter and no body", () => {
    const input = "---\nname: foo\n---\n";
    assert.equal(stripFrontmatter(input), "");
  });
});

// ---------------------------------------------------------------------------
// buildUnfoldMessage
// ---------------------------------------------------------------------------

describe("buildUnfoldMessage", () => {
  it("asks to pick up with no state and no guidance", () => {
    const msg = buildUnfoldMessage({ state: null, guidance: undefined });
    assert.ok(msg.includes("fresh project"), "should mention fresh project");
    assert.ok(msg.includes("pick up"), "should ask to pick up");
    assert.ok(msg.includes("no existing code or tech stack to explore yet"), "should include fresh-project anti-exploration note");
    assert.ok(!msg.includes("Sensei guidance"), "should not mention sensei guidance");
  });

  it("includes state yaml block when state is present", () => {
    const msg = buildUnfoldMessage({ state: "feature:\n  name: Foo", guidance: undefined });
    assert.ok(msg.includes("```yaml"), "should include yaml code block");
    assert.ok(msg.includes("feature:"), "should include state content");
    assert.ok(!msg.includes("fresh project"), "should not mention fresh project");
  });

  it("includes guidance when provided", () => {
    const msg = buildUnfoldMessage({ state: null, guidance: "focus on login" });
    assert.ok(msg.includes("Sensei guidance: focus on login"), "should include guidance");
    assert.ok(msg.includes("no existing code or tech stack to explore yet"), "should keep fresh-project anti-exploration note with guidance");
  });

  it("includes both state and guidance when both are provided", () => {
    const msg = buildUnfoldMessage({ state: "phase: defining", guidance: "use REST" });
    assert.ok(msg.includes("phase: defining"));
    assert.ok(msg.includes("Sensei guidance: use REST"));
  });
});

// ---------------------------------------------------------------------------
// Structural: /unfold command and before_agent_start are registered
// ---------------------------------------------------------------------------

describe("structural invariants", () => {
  const src = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");

  it("registers the unfold command", () => {
    assert.ok(
      src.includes('registerCommand("unfold"'),
      'index.ts must call registerCommand("unfold")',
    );
  });

  it("registers a before_agent_start handler for skill injection", () => {
    assert.ok(
      src.includes('"before_agent_start"'),
      'index.ts must register a "before_agent_start" event handler',
    );
  });

  it("guards against calling sendUserMessage while agent is busy", () => {
    assert.ok(
      src.includes("isIdle()"),
      "index.ts must check ctx.isIdle() before calling sendUserMessage",
    );
  });

  it("registers a display-only context filter for unfolding child output", () => {
    assert.ok(
      src.includes('filterDisplayOnlyMessages(event, UNFOLDING_CHILD_OUTPUT_TYPE)'),
      "index.ts must filter unfolding child output messages from LLM context",
    );
  });

  it("registers a message renderer for unfolding child output", () => {
    assert.ok(
      src.includes('registerMessageRenderer<{ lines?: string }>(UNFOLDING_CHILD_OUTPUT_TYPE'),
      "index.ts must register a renderer for unfolding child output messages",
    );
  });
});
