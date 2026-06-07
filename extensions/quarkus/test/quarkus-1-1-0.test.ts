/**
 * Tests for quarkus-agent-mcp 1.1.0 new tools:
 *   - quarkus_list      — list all managed instances
 *   - quarkus_agent_log — read/enable/disable the MCP server's own log file
 *   - quarkus_updateSkill — create/update a global skill customisation
 *   - quarkus_saveSkill   — materialise a skill into .agent/skills/
 *
 * All four must be in REQUIRED_TOOLS so the missing-tool warning fires if they
 * are absent (e.g. stale jbang cache).
 *
 * quarkus_list and quarkus_agent_log each get a /quarkus subcommand.
 * quarkus_updateSkill and quarkus_saveSkill are LLM-driven authoring tools
 * that only need TOOL_GUIDELINES entries.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");

// ---------------------------------------------------------------------------
// A. All four new tools are in REQUIRED_TOOLS
// ---------------------------------------------------------------------------

describe("new 1.1.0 tools in REQUIRED_TOOLS", () => {
  for (const tool of ["quarkus_list", "quarkus_agent_log", "quarkus_updateSkill", "quarkus_saveSkill"]) {
    it(`REQUIRED_TOOLS contains ${tool}`, () => {
      const idx = src.indexOf("REQUIRED_TOOLS");
      assert.ok(idx >= 0, "REQUIRED_TOOLS not found");
      const block = src.slice(idx, idx + 800);
      assert.ok(block.includes(`"${tool}"`), `REQUIRED_TOOLS must contain "${tool}"`);
    });
  }
});

// ---------------------------------------------------------------------------
// B. /quarkus list subcommand
// ---------------------------------------------------------------------------

describe("/quarkus list subcommand", () => {
  it("'list' is in ALL_SUBCOMMANDS", () => {
    // list is in DIRECT_SUBCOMMANDS, which is spread into ALL_SUBCOMMANDS
    const idx = src.indexOf("DIRECT_SUBCOMMANDS =");
    assert.ok(idx >= 0, "DIRECT_SUBCOMMANDS not found");
    const block = src.slice(idx, idx + 200);
    assert.ok(block.includes('"list"'), 'DIRECT_SUBCOMMANDS (spread into ALL_SUBCOMMANDS) must include "list"');
  });

  it("TOOL_NAME maps 'list' to quarkus_list", () => {
    const idx = src.indexOf("const TOOL_NAME:");
    assert.ok(idx >= 0, "TOOL_NAME not found");
    const block = src.slice(idx, idx + 700);
    assert.ok(
      block.match(/list\s*:\s*["']quarkus_list["']/),
      'TOOL_NAME["list"] must be "quarkus_list"',
    );
  });

  it("'list' is in DIRECT_SUBCOMMANDS", () => {
    const idx = src.indexOf("DIRECT_SUBCOMMANDS =");
    assert.ok(idx >= 0, "DIRECT_SUBCOMMANDS not found");
    const block = src.slice(idx, idx + 200);
    assert.ok(block.includes('"list"'), 'DIRECT_SUBCOMMANDS must include "list"');
  });
});

// ---------------------------------------------------------------------------
// C. /quarkus agent-log subcommand
// ---------------------------------------------------------------------------

describe("/quarkus agent-log subcommand", () => {
  it("'agent-log' is in ALL_SUBCOMMANDS", () => {
    // agent-log is in DIRECT_SUBCOMMANDS, which is spread into ALL_SUBCOMMANDS
    const idx = src.indexOf("DIRECT_SUBCOMMANDS =");
    assert.ok(idx >= 0, "DIRECT_SUBCOMMANDS not found");
    const block = src.slice(idx, idx + 200);
    assert.ok(block.includes('"agent-log"'), 'DIRECT_SUBCOMMANDS (spread into ALL_SUBCOMMANDS) must include "agent-log"');
  });

  it("TOOL_NAME maps 'agent-log' to quarkus_agent_log", () => {
    const idx = src.indexOf("const TOOL_NAME:");
    assert.ok(idx >= 0, "TOOL_NAME not found");
    const block = src.slice(idx, idx + 700);
    assert.ok(
      block.match(/"agent-log"\s*:\s*["']quarkus_agent_log["']/),
      'TOOL_NAME["agent-log"] must be "quarkus_agent_log"',
    );
  });

  it("'agent-log' is in DIRECT_SUBCOMMANDS", () => {
    const idx = src.indexOf("DIRECT_SUBCOMMANDS =");
    assert.ok(idx >= 0, "DIRECT_SUBCOMMANDS not found");
    const block = src.slice(idx, idx + 200);
    assert.ok(block.includes('"agent-log"'), 'DIRECT_SUBCOMMANDS must include "agent-log"');
  });
});

// ---------------------------------------------------------------------------
// D. TOOL_GUIDELINES for new tools
// ---------------------------------------------------------------------------

describe("TOOL_GUIDELINES for new 1.1.0 tools", () => {
  it("TOOL_GUIDELINES has a quarkus_agent_log entry", () => {
    assert.ok(
      src.includes("quarkus_agent_log:"),
      'TOOL_GUIDELINES must have a "quarkus_agent_log" entry',
    );
  });

  it("TOOL_GUIDELINES has a quarkus_updateSkill entry", () => {
    assert.ok(
      src.includes("quarkus_updateSkill:"),
      'TOOL_GUIDELINES must have a "quarkus_updateSkill" entry',
    );
  });

  it("TOOL_GUIDELINES has a quarkus_saveSkill entry", () => {
    assert.ok(
      src.includes("quarkus_saveSkill:"),
      'TOOL_GUIDELINES must have a "quarkus_saveSkill" entry',
    );
  });

  it("quarkus_updateSkill guideline mentions asking enhance vs override", () => {
    const idx = src.indexOf("quarkus_updateSkill:");
    assert.ok(idx >= 0, "quarkus_updateSkill guideline not found");
    const block = src.slice(idx, idx + 400);
    assert.ok(
      block.match(/enhance/i) && block.match(/override/i),
      `quarkus_updateSkill guideline must mention enhance vs override, got:\n${block}`,
    );
  });

  it("quarkus_saveSkill guideline mentions .agent/skills", () => {
    const idx = src.indexOf("quarkus_saveSkill:");
    assert.ok(idx >= 0, "quarkus_saveSkill guideline not found");
    const block = src.slice(idx, idx + 400);
    assert.ok(
      block.match(/\.agent\/skills/i) || block.match(/project.{0,20}skill/i),
      `quarkus_saveSkill guideline must mention .agent/skills, got:\n${block}`,
    );
  });
});
