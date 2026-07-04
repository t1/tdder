/**
 * Tests for the /unfold command helpers and structural invariants.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Helpers extracted for testing — import directly from the module under test
// ---------------------------------------------------------------------------

import {
  stripFrontmatter,
  buildUnfoldMessage,
  parseFrontmatterTools,
  resolveToolAllowlist,
} from "../unfold-helpers.ts";

// ---------------------------------------------------------------------------
// parseFrontmatterTools
// ---------------------------------------------------------------------------

describe("parseFrontmatterTools", () => {
  const poMd = readFileSync(new URL("../roles/po.md", import.meta.url).pathname, "utf8");
  const architectMd = readFileSync(new URL("../roles/architect.md", import.meta.url).pathname, "utf8");
  const coderMd = readFileSync(new URL("../roles/coder.md", import.meta.url).pathname, "utf8");
  const uxDesignerMd = readFileSync(new URL("../roles/ux-designer.md", import.meta.url).pathname, "utf8");
  const apiDesignerMd = readFileSync(new URL("../roles/api-designer.md", import.meta.url).pathname, "utf8");
  const uiExpertMd = readFileSync(new URL("../roles/ui-expert.md", import.meta.url).pathname, "utf8");

  it("po.md declares the expected tool allowlist", () => {
    const tools = parseFrontmatterTools(poMd);
    assert.deepEqual(tools, [
      "read",
      "write",
      "edit",
      "ask_sensei",
      "task_delegate",
      "task_finished",
      "task_block",
      "task_unblock",
      "task_reopen",
      "task_rollback",
      "task_accept",
      "task_read",
      "task_list",
      "maven_run",
    ]);
  });

  it("architect.md declares the expected tool allowlist", () => {
    const tools = parseFrontmatterTools(architectMd);
    assert.deepEqual(tools, [
      "read",
      "write",
      "edit",
      "ask_sensei",
      "maven_run",
      "task_delegate",
      "task_finished",
      "task_block",
      "task_unblock",
      "task_reopen",
      "task_rollback",
      "task_accept",
      "task_read",
      "task_list",
    ]);
  });
  it("coder.md declares the expected tool allowlist", () => {
    const tools = parseFrontmatterTools(coderMd);
    assert.deepEqual(tools, [
      "read",
      "write",
      "edit",
      "ask_sensei",
      "maven_run",
      "task_finished",
      "task_block",
    ]);
  });

  it("ux-designer.md declares the expected tool allowlist", () => {
    const tools = parseFrontmatterTools(uxDesignerMd);
    assert.deepEqual(tools, [
      "read",
      "write",
      "edit",
      "ask_sensei",
      "task_finished",
      "task_block",
    ]);
  });

  it("api-designer.md declares the expected tool allowlist", () => {
    const tools = parseFrontmatterTools(apiDesignerMd);
    assert.deepEqual(tools, [
      "read",
      "write",
      "edit",
      "ask_sensei",
      "task_finished",
      "task_block",
    ]);
  });

  it("ui-expert.md declares the expected tool allowlist", () => {
    const tools = parseFrontmatterTools(uiExpertMd);
    assert.deepEqual(tools, [
      "read",
      "write",
      "edit",
      "ask_sensei",
      "task_finished",
      "task_block",
    ]);
  });
});

// ---------------------------------------------------------------------------
// resolveToolAllowlist
// ---------------------------------------------------------------------------

describe("resolveToolAllowlist", () => {
  it("passes static entries through unchanged regardless of live list", () => {
    const result = resolveToolAllowlist(["read", "task_block"], ["read", "write", "maven_run"]);
    assert.deepEqual(result, ["read", "task_block"]);
  });

  it("expands a wildcard to all matching live tools", () => {
    const result = resolveToolAllowlist(["read", "idea_*"], ["read", "idea_search_symbol", "idea_build_project", "maven_run"]);
    assert.deepEqual(result, ["read", "idea_search_symbol", "idea_build_project"]);
  });

  it("expands a wildcard with no matches to nothing", () => {
    const result = resolveToolAllowlist(["read", "browser_*"], ["read", "maven_run"]);
    assert.deepEqual(result, ["read"]);
  });

  it("expands multiple wildcards mixed with static entries", () => {
    const result = resolveToolAllowlist(
      ["read", "idea_*", "task_block", "browser_*"],
      ["read", "idea_search_symbol", "idea_build_project", "browser_navigate", "maven_run"],
    );
    assert.deepEqual(result, ["read", "idea_search_symbol", "idea_build_project", "task_block", "browser_navigate"]);
  });

  it("returns the list as-is when there are no wildcards", () => {
    const result = resolveToolAllowlist(["read", "write", "maven_run"], ["read", "write", "maven_run", "bash"]);
    assert.deepEqual(result, ["read", "write", "maven_run"]);
  });
});

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
  it("starts directly with no state and no guidance", () => {
    const msg = buildUnfoldMessage({ state: null, guidance: undefined });
    assert.ok(msg.includes("fresh project"), "should mention fresh project");
    assert.ok(msg.includes("Start the unfolding process now."), "should tell a fresh project to start directly");
    assert.ok(!msg.includes("pick up where the process left off"), "should not imply prior progress on a fresh project");
    assert.ok(msg.includes("no existing code or tech stack to explore yet"), "should include fresh-project anti-exploration note");
    assert.ok(!msg.includes("Sensei guidance"), "should not mention sensei guidance");
  });

  it("includes state yaml block when state is present", () => {
    const msg = buildUnfoldMessage({ state: "feature:\n  name: Foo", guidance: undefined });
    assert.ok(msg.includes("```yaml"), "should include yaml code block");
    assert.ok(msg.includes("feature:"), "should include state content");
    assert.ok(msg.includes("Please continue from the current state."), "should use continuation wording when state exists");
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

  it("adds explicit fresh-project anti-exploration guidance before building the unfold message", () => {
    assert.ok(
      src.includes("This is a genuinely empty project: no existing code, no pom.xml, no tech stack to discover yet."),
      "index.ts must add explicit fresh-project anti-exploration guidance",
    );
    assert.ok(
      src.includes("Do not explore the workspace for implementation artifacts."),
      "index.ts must explicitly tell the PO not to explore implementation artifacts on a fresh project",
    );
  });

  it("guards against calling sendUserMessage while agent is busy", () => {
    assert.ok(
      src.includes("isIdle()"),
      "index.ts must check ctx.isIdle() before calling sendUserMessage",
    );
  });

  it("parses a --debug flag for the unfold command", () => {
    assert.ok(
      src.includes("--debug"),
      "index.ts must recognize a --debug flag for /unfold",
    );
  });

  it("exports commissioner sessions on delegate/reopen/unblock in debug mode", () => {
    assert.ok(
      src.includes("exportTaskCommissionerDebugHtmlIfEnabled"),
      "index.ts must export commissioner sessions for commissioner handovers in debug mode",
    );
  });

  it("registers a display-only context filter for unfolding child output", () => {
    assert.ok(
      src.includes('filterDisplayOnlyMessages(event, UNFOLDING_CHILD_OUTPUT_TYPE)'),
      "index.ts must filter unfolding child output messages from LLM context",
    );
  });

  it("captures inherited extension paths after session start, once extension runtime is initialized", () => {
    assert.ok(
      src.includes('pi.on("session_start"'),
      "index.ts should defer extension-path capture until session_start",
    );
    assert.ok(
      src.includes("inferInheritedExtensionPaths(pi)"),
      "index.ts should derive child-session extension paths from the parent session",
    );
    assert.ok(
      src.includes("pi.getAllTools()"),
      "index.ts should inspect loaded extension-owned tools",
    );
    assert.ok(
      src.includes("pi.getCommands()"),
      "index.ts should inspect loaded extension-owned commands",
    );
  });

  it("registers a message renderer for unfolding child output", () => {
    assert.ok(
      src.includes('registerMessageRenderer<ChildOutputDetails>(UNFOLDING_CHILD_OUTPUT_TYPE'),
      "index.ts must register a renderer for unfolding child output messages",
    );
    assert.ok(
      src.includes('renderChildOutputBox('),
      "index.ts renderer should delegate child-output framing/rendering",
    );
    assert.ok(
      src.includes('childOutputEvents'),
      "index.ts renderer should consume structured child output events",
    );
  });

  it("documents unfolding details in the extension README and links to it from the root README", () => {
    const rootReadme = readFileSync(new URL("../../../README.md", import.meta.url).pathname, "utf8");
    const extensionReadme = readFileSync(new URL("../../unfolding/README.md", import.meta.url).pathname, "utf8");
    assert.ok(
      rootReadme.includes("extensions/unfolding/README.md"),
      "root README must link to the unfolding extension README",
    );
    assert.ok(
      extensionReadme.includes("## Task tools"),
      "extension README must document unfolding task tools",
    );
    assert.ok(
      extensionReadme.includes("UNFOLDING_TEST_MODEL=provider/modelId npm --prefix extensions/unfolding run test:real-integration"),
      "extension README must document the real integration test env-var interface",
    );
    assert.ok(
      extensionReadme.includes("reads the requested model from `UNFOLDING_TEST_MODEL`"),
      "extension README must document UNFOLDING_TEST_MODEL as the harness model source",
    );
    assert.ok(
      extensionReadme.includes("npm --prefix extensions/unfolding run clean"),
      "extension README must document how to remove preserved smoke-test temp workspaces",
    );
  });
});
