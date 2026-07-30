/**
 * Tests for the /unfold command helpers and structural invariants.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Helpers extracted for testing — import directly from the module under test
// ---------------------------------------------------------------------------

import {
  stripFrontmatter,
  buildUnfoldMessage,
  parseFrontmatterTools,
  parseFrontmatterDelegatesTo,
  resolveToolAllowlist,
  parsePathRestrictions,
  parseFrontmatterPathRestrictions,
  isPathAllowed,
  isToolPathAllowed,
} from "../unfold-helpers.ts";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

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
  const cleanCodeReviewerMd = readFileSync(new URL("../roles/clean-code-reviewer.md", import.meta.url).pathname, "utf8");

  const claudeAgentDir = new URL("../../../agents/", import.meta.url);
  const claudeUnfoldingAgents = readdirSync(claudeAgentDir)
    .filter(name => name.startsWith("unfolding-") && name.endsWith(".md"))
    .map(name => ({ name, content: readFileSync(new URL(`../../../agents/${name}`, import.meta.url).pathname, "utf8") }));

  it("po.md declares the expected tool allowlist", () => {
    const tools = parseFrontmatterTools(poMd);
    assert.deepEqual(tools, [
      "read",
      "write",
      "edit",
      "delete",
      "ask_sensei",
      "task_delegate",
      "task_continue",
      "task_finished",
      "task_block",
      "task_unblock",
      "task_reopen",
      "task_rollback",
      "task_accept",
      "maven_run",
    ]);
  });

  it("architect.md declares the expected tool allowlist", () => {
    const tools = parseFrontmatterTools(architectMd);
    assert.deepEqual(tools, [
      "read",
      "write",
      "edit",
      "delete",
      "ask_sensei",
      "maven_*",
      "idea_*",
      "jdtls_*",
      "quarkus_*",
      "task_delegate",
      "task_continue",
      "task_finished",
      "task_block",
      "task_unblock",
      "task_reopen",
      "task_rollback",
      "task_accept",
    ]);
  });

  it("architect role tells empty Quarkus projects to bootstrap without embedding recreate mechanics", () => {
    assert.match(architectMd, /Quarkus empty-project bootstrap rule:/);
    assert.match(architectMd, /Call `quarkus_bootstrap` immediately/);
    assert.doesNotMatch(architectMd, /task_block` with `recreate\.resume_message`/);
  });

  it("architect role sends technical implementation problems to ask_sensei instead of blocking to the PO", () => {
    assert.match(architectMd, /Technical implementation problem that needs guidance/);
    assert.match(architectMd, /Do \*\*not\*\* block to the PO\. This is not a PO question\./);
    assert.match(architectMd, /Ask the Sensei directly with `ask_sensei`, primarily as a \*\*brief problem report\*\*/);
    assert.match(architectMd, /Do \*\*not\*\* force the problem into an ADR first/);
    assert.match(architectMd, /Do \*\*not\*\* use `task_block` for technical implementation problems\./);
  });

  it("po+architect roles require explicit product evidence before protocol words like REST count as valid PO input", () => {
    assert.match(poMd, /Externally visible integration contract — but only when external integrators are actual product actors/);
    assert.match(poMd, /Commission the API Designer only when \*\*all\*\* of these are true:/);
    assert.match(poMd, /the external consumer is explicit/);
    assert.match(poMd, /programmatic integration is itself part of the user\/customer value of this Feature/);
    assert.match(poMd, /Use only these sections in the `\[ARCH\]` task, in this order:/);
    assert.match(architectMd, /If the handoff uses protocol or contract words such as `REST`, `REST\/JSON`, `GraphQL`, `webhook`, `event stream`,/);
    assert.match(architectMd, /require explicit product evidence inside the handoff itself/);
    assert.match(architectMd, /If any of that proof is missing, treat the handoff as malformed technical steering/);
    assert.match(architectMd, /UX specs, customer-facing integration-contract specs, and clearly labeled/);
  });

  it("po+architect roles forbid tool-specific workaround instructions in ARCH handoffs", () => {
    const normalizedPoMd = normalizeWhitespace(poMd);
    const normalizedArchitectMd = normalizeWhitespace(architectMd);

    assert.match(normalizedPoMd, /Tool- or workflow-specific workaround instructions/);
    assert.match(normalizedPoMd, /`use bash`/);
    assert.match(normalizedPoMd, /`cat > file`/);
    assert.match(normalizedPoMd, /`do not use write`/);

    assert.match(normalizedArchitectMd, /Tool- or workflow-specific workaround instructions/);
    assert.match(normalizedArchitectMd, /`use bash`/);
    assert.match(normalizedArchitectMd, /`cat > file`/);
    assert.match(normalizedArchitectMd, /`do not use write`/);
  });
  it("coder.md declares the expected tool allowlist", () => {
    const tools = parseFrontmatterTools(coderMd);
    assert.deepEqual(tools, [
      "read",
      "write",
      "edit",
      "delete",
      "ask_sensei",
      "maven_*",
      "idea_*",
      "jdtls_*",
      "quarkus_*",
      "task_delegate",
      "task_accept",
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
      "delete",
      "ask_sensei",
      "browser_*",
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
      "delete",
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
      "delete",
      "ask_sensei",
      "task_finished",
      "task_block",
    ]);
  });

  it("clean-code-reviewer.md declares the expected tool allowlist", () => {
    const tools = parseFrontmatterTools(cleanCodeReviewerMd);
    assert.deepEqual(tools, [
      "read",
      "task_finished",
      "task_block",
    ]);
  });

  it("Claude unfolding agents do not expose Bash", () => {
    for (const { name, content } of claudeUnfoldingAgents) {
      assert.doesNotMatch(content, /^tools:.*\bBash\b.*$/m, `${name} must not expose Bash`);
    }
  });
});

describe("parseFrontmatterDelegatesTo", () => {
  const poMd = readFileSync(new URL("../roles/po.md", import.meta.url).pathname, "utf8");
  const architectMd = readFileSync(new URL("../roles/architect.md", import.meta.url).pathname, "utf8");
  const coderMd = readFileSync(new URL("../roles/coder.md", import.meta.url).pathname, "utf8");
  const uxDesignerMd = readFileSync(new URL("../roles/ux-designer.md", import.meta.url).pathname, "utf8");
  const apiDesignerMd = readFileSync(new URL("../roles/api-designer.md", import.meta.url).pathname, "utf8");
  const uiExpertMd = readFileSync(new URL("../roles/ui-expert.md", import.meta.url).pathname, "utf8");

  it("po.md declares the expected allowed delegate roles", () => {
    assert.deepEqual(parseFrontmatterDelegatesTo(poMd), ["architect", "ux-designer", "api-designer"]);
  });

  it("architect.md declares the expected allowed delegate roles", () => {
    assert.deepEqual(parseFrontmatterDelegatesTo(architectMd), ["coder", "ui-expert"]);
  });

  it("coder.md declares the expected allowed delegate roles", () => {
    assert.deepEqual(parseFrontmatterDelegatesTo(coderMd), ["clean-code-reviewer"]);
  });

  it("non-commissioner roles declare an explicit empty delegate list", () => {
    assert.deepEqual(parseFrontmatterDelegatesTo(uxDesignerMd), []);
    assert.deepEqual(parseFrontmatterDelegatesTo(apiDesignerMd), []);
    assert.deepEqual(parseFrontmatterDelegatesTo(uiExpertMd), []);
  });
});

// ---------------------------------------------------------------------------
// parseFrontmatterPathRestrictions — role files
// ---------------------------------------------------------------------------

describe("parseFrontmatterPathRestrictions (role files)", () => {
  const poMd = readFileSync(new URL("../roles/po.md", import.meta.url).pathname, "utf8");
  const architectMd = readFileSync(new URL("../roles/architect.md", import.meta.url).pathname, "utf8");
  const coderMd = readFileSync(new URL("../roles/coder.md", import.meta.url).pathname, "utf8");
  const uxDesignerMd = readFileSync(new URL("../roles/ux-designer.md", import.meta.url).pathname, "utf8");
  const apiDesignerMd = readFileSync(new URL("../roles/api-designer.md", import.meta.url).pathname, "utf8");

  it("po.md blocks docs/adr/ reads then allows docs/ reads then blocks everything else", () => {
    const rules = parseFrontmatterPathRestrictions(poMd);
    assert.ok(rules, "PO must declare path restrictions");
    assert.equal(isPathAllowed("read", "docs/adr/INDEX.md", rules!), false, "PO must not read docs/adr/");
    assert.equal(isPathAllowed("read", "docs/product.md", rules!), true, "PO may read other docs/");
    assert.equal(isPathAllowed("read", "src/Main.java", rules!), false, "PO must not read source files");
    assert.equal(isPathAllowed("write", "docs/product.md", rules!), true, "write is not restricted by read rules");
  });

  it("architect.md blocks docs/ats/*.feature reads and restricts test writes to rules+acceptance+system", () => {
    const rules = parseFrontmatterPathRestrictions(architectMd);
    assert.ok(rules, "Architect must declare path restrictions");
    assert.equal(isPathAllowed("read", "docs/ats/register-owner.feature", rules!), false, "Architect must not read AT feature files");
    assert.equal(isPathAllowed("read", "docs/ats/INDEX.md", rules!), true, "Architect may read other docs/ats/ files");
    assert.equal(isPathAllowed("read", "src/Main.java", rules!), true, "Architect may read source files");
    assert.equal(isPathAllowed("write", "src/test/java/test/rules/RegisterOwnerRules.java", rules!), true, "Architect may write business-rule tests");
    assert.equal(isPathAllowed("write", "src/test/java/test/acceptance/RegisterOwnerAT.java", rules!), true, "Architect may write acceptance tests");
    assert.equal(isPathAllowed("write", "src/test/java/test/system/RegisterOwnerST.java", rules!), true, "Architect may write system tests");
    assert.equal(isPathAllowed("write", "src/test/java/test/unit/RegisterOwnerTest.java", rules!), false, "Architect must not write unit tests");
    assert.equal(isPathAllowed("write", "src/main/java/Foo.java", rules!), true, "Architect may write source files");
  });

  it("coder.md allows docs/adr/ and shared step catalogs, then blocks other docs and denies acceptance/system tests", () => {
    const rules = parseFrontmatterPathRestrictions(coderMd);
    assert.ok(rules, "Coder must declare path restrictions");
    assert.equal(isPathAllowed("read", "docs/adr/INDEX.md", rules!), true, "Coder may read docs/adr/");
    assert.equal(isPathAllowed("read", "docs/ats/STEPS.md", rules!), true, "Coder may read AT step catalog");
    assert.equal(isPathAllowed("read", "docs/rules/STEPS.md", rules!), true, "Coder may read business-rule step catalog");
    assert.equal(isPathAllowed("read", "docs/product.md", rules!), false, "Coder must not read other docs/");
    assert.equal(isPathAllowed("read", "docs/rules/pricing.feature", rules!), false, "Coder must not read business-rule feature files");
    assert.equal(isPathAllowed("write", "docs/adr/INDEX.md", rules!), false, "Coder must not write to docs/");
    assert.equal(isPathAllowed("read", "src/test/java/test/unit/TodoTest.java", rules!), true, "Coder may read unit tests");
    assert.equal(isPathAllowed("write", "src/test/java/test/unit/TodoTest.java", rules!), true, "Coder may write unit tests");
    assert.equal(isPathAllowed("write", "src/test/java/test/unit/com/example/TodoTest.java", rules!), true, "Coder may write unit tests in sub-packages");
    assert.equal(isPathAllowed("read", "src/test/java/test/system/RegisterOwnerST.java", rules!), false, "Coder must not read system tests");
    assert.equal(isPathAllowed("write", "src/test/java/test/system/RegisterOwnerST.java", rules!), false, "Coder must not write system tests");
    assert.equal(isPathAllowed("read", "src/test/java/test/acceptance/RegisterOwnerAT.java", rules!), false, "Coder must not read acceptance tests");
    assert.equal(isPathAllowed("write", "src/test/java/test/acceptance/RegisterOwnerAT.java", rules!), false, "Coder must not write acceptance tests");
    assert.equal(isPathAllowed("read", "src/main/java/Foo.java", rules!), true, "Coder may read source files");
    assert.equal(isPathAllowed("write", "src/main/java/Foo.java", rules!), true, "Coder may write source files");
  });

  it("ux-designer.md blocks docs/rules/ reads", () => {
    const rules = parseFrontmatterPathRestrictions(uxDesignerMd);
    assert.ok(rules, "UX Designer must declare path restrictions");
    assert.equal(isPathAllowed("read", "docs/rules/pricing.feature", rules!), false, "UX Designer must not read rules");
    assert.equal(isPathAllowed("read", "docs/ux/INDEX.md", rules!), true, "UX Designer may read docs/ux/");
  });

  it("api-designer.md blocks docs/rules/ reads", () => {
    const rules = parseFrontmatterPathRestrictions(apiDesignerMd);
    assert.ok(rules, "API Designer must declare path restrictions");
    assert.equal(isPathAllowed("read", "docs/rules/pricing.feature", rules!), false, "API Designer must not read rules");
    assert.equal(isPathAllowed("read", "docs/api/INDEX.md", rules!), true, "API Designer may read docs/api/");
  });
});

// ---------------------------------------------------------------------------
// isToolPathAllowed — absolute paths are made cwd-relative before matching
// ---------------------------------------------------------------------------

describe("isToolPathAllowed", () => {
  const cwd = "/workspace/demo";
  const poRules = parsePathRestrictions(["read deny: docs/adr/**", "read allow: docs/**", "read deny: **"]);

  it("matches absolute paths against the relative globs", () => {
    assert.equal(isToolPathAllowed("read", `${cwd}/docs/ats/INDEX.md`, poRules, cwd), true, "absolute path under an allowed glob must pass");
    assert.equal(isToolPathAllowed("read", `${cwd}/docs/adr/INDEX.md`, poRules, cwd), false, "absolute path under a denied glob must be blocked");
    assert.equal(isToolPathAllowed("read", `${cwd}/src/Main.java`, poRules, cwd), false, "absolute path outside any allow must hit the catch-all deny");
  });

  it("passes relative paths through unchanged", () => {
    assert.equal(isToolPathAllowed("read", "docs/ats/INDEX.md", poRules, cwd), true);
    assert.equal(isToolPathAllowed("read", "src/Main.java", poRules, cwd), false);
  });

  it("denies paths escaping the cwd", () => {
    assert.equal(isToolPathAllowed("read", "/etc/passwd", poRules, cwd), false, "absolute path outside the cwd must be denied");
    assert.equal(isToolPathAllowed("read", "../other-project/docs/product.md", poRules, cwd), false, "relative path escaping the cwd must be denied");
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
// parsePathRestrictions / isPathAllowed
// ---------------------------------------------------------------------------

describe("parsePathRestrictions", () => {
  it("parses a read deny rule", () => {
    const rules = parsePathRestrictions(["read deny: docs/adr/**"]);
    assert.deepEqual(rules, [{ tools: ["read"], action: "deny", glob: "docs/adr/**" }]);
  });

  it("parses rw as read, write, and edit", () => {
    const rules = parsePathRestrictions(["rw deny: **/*ST.java"]);
    assert.deepEqual(rules, [{ tools: ["read", "write", "edit"], action: "deny", glob: "**/*ST.java" }]);
  });

  it("parses multiple rules in order", () => {
    const rules = parsePathRestrictions(["read allow: docs/adr/**", "read deny: docs/**"]);
    assert.deepEqual(rules, [
      { tools: ["read"], action: "allow", glob: "docs/adr/**" },
      { tools: ["read"], action: "deny", glob: "docs/**" },
    ]);
  });
});

describe("isPathAllowed", () => {
  it("returns true when path matches an allow rule", () => {
    const rules = parsePathRestrictions(["read allow: docs/adr/**", "read deny: docs/**"]);
    assert.equal(isPathAllowed("read", "docs/adr/INDEX.md", rules), true);
  });

  it("returns false when path matches a deny rule", () => {
    const rules = parsePathRestrictions(["read allow: docs/adr/**", "read deny: docs/**"]);
    assert.equal(isPathAllowed("read", "docs/product.md", rules), false);
  });

  it("returns true when no rule matches (default allow)", () => {
    const rules = parsePathRestrictions(["read deny: docs/adr/**"]);
    assert.equal(isPathAllowed("read", "src/Main.java", rules), true);
  });

  it("first matching rule wins", () => {
    const rules = parsePathRestrictions(["read deny: docs/**", "read allow: docs/adr/**"]);
    // deny comes first — docs/adr/INDEX.md should be denied
    assert.equal(isPathAllowed("read", "docs/adr/INDEX.md", rules), false);
  });

  it("read restriction does not affect write", () => {
    const rules = parsePathRestrictions(["read deny: docs/adr/**"]);
    assert.equal(isPathAllowed("write", "docs/adr/INDEX.md", rules), true);
  });

  it("glob matching is case-sensitive (deny does not match different case)", () => {
    const rules = parsePathRestrictions(["read deny: docs/adr/**"]);
    // 'DOCS/adr/INDEX.md' has a different case prefix — must NOT be denied
    assert.equal(isPathAllowed("read", "DOCS/adr/INDEX.md", rules), true);
  });

  it("glob matching is case-sensitive (deny matches exact case)", () => {
    const rules = parsePathRestrictions(["read deny: docs/adr/**"]);
    assert.equal(isPathAllowed("read", "docs/adr/INDEX.md", rules), false);
  });
});

describe("parseFrontmatterPathRestrictions", () => {
  it("returns undefined when key is absent", () => {
    assert.equal(parseFrontmatterPathRestrictions("---\nname: test\n---\n# body"), undefined);
  });

  it("parses rules from frontmatter", () => {
    const content = "---\nname: po\npath-restrictions:\n  - read deny: docs/adr/**\n---\n# body";
    const rules = parseFrontmatterPathRestrictions(content);
    assert.deepEqual(rules, [{ tools: ["read"], action: "deny", glob: "docs/adr/**" }]);
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
  it("builds a fresh-project kickoff message", () => {
    const msg = buildUnfoldMessage({
      workflowInstruction: "No live top-level PO task found — this appears to be a fresh project. Start the unfolding process now by delegating to the PO.",
      guidance: undefined,
      freshProject: true,
    });
    assert.ok(msg.includes("fresh project"), "should mention fresh project");
    assert.ok(msg.includes("delegating to the PO"), "should tell a fresh project how to start");
    assert.ok(msg.includes("Fresh project: no code or tech stack exists yet."), "should include fresh-project anti-exploration note");
    assert.ok(msg.includes("Don’t explore implementation artifacts."), "should tell the agent not to explore implementation artifacts");
    assert.ok(msg.includes("Start with `docs/product.md` and the first planning artifacts."), "should give the first concrete step");
    assert.ok(!msg.includes("Sensei guidance"), "should not mention sensei guidance");
  });

  it("builds a resume message without synthetic bookmark wrappers", () => {
    const msg = buildUnfoldMessage({
      workflowInstruction: "Current top-level PO task `po-login` is in progress. Continue that task; do not start a new one.",
      guidance: undefined,
    });
    assert.ok(msg.includes("po-login"), "should include the task slug");
    assert.ok(msg.includes("Continue that task"), "should use direct continuation wording");
    assert.ok(!msg.includes("workflow bookmark"), "should not mention bookmarks");
    assert.ok(!msg.includes("```text"), "should not include a synthetic code block");
  });

  it("includes guidance when provided", () => {
    const msg = buildUnfoldMessage({
      workflowInstruction: "No live top-level PO task found — this appears to be a fresh project. Start the unfolding process now by delegating to the PO.",
      guidance: "focus on login",
      freshProject: true,
    });
    assert.ok(msg.includes("Sensei guidance: focus on login"), "should include guidance");
    assert.ok(msg.includes("Fresh project: no code or tech stack exists yet."), "should keep fresh-project anti-exploration note with guidance");
  });

  it("includes both workflow instruction and guidance", () => {
    const msg = buildUnfoldMessage({
      workflowInstruction: "Current top-level PO task `po-login` is blocked: waiting for product clarification. Resolve the commissioner issue and then resume that task; do not start a new one.",
      guidance: "use REST",
    });
    assert.ok(msg.includes("po-login"));
    assert.ok(msg.includes("waiting for product clarification"));
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

  it("passes fresh-project state into buildUnfoldMessage instead of inlining duplicate guidance", () => {
    assert.ok(
      src.includes("const freshProject = directDelegate.kind === \"none\";"),
      "index.ts must detect the fresh-project case",
    );
    assert.ok(
      src.includes("buildUnfoldMessage({ workflowInstruction, guidance, freshProject })"),
      "index.ts must let buildUnfoldMessage render the fresh-project guidance",
    );
    assert.ok(
      !src.includes("This is a genuinely empty project: no existing code, no pom.xml, no tech stack to discover yet."),
      "index.ts must not inline the old verbose fresh-project guidance",
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
      extensionReadme.includes("`delete`"),
      "extension README must document the delete tool",
    );
    assert.ok(
      extensionReadme.includes("This includes technical implementation problems during execution, not just formal\narchitectural decisions."),
      "extension README must state that technical implementation problems also go directly to the Sensei",
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
