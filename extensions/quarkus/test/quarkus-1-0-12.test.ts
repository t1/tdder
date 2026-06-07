/**
 * Tests for quarkus-agent-mcp 1.0.12 compatibility and new features.
 *
 * Breaking changes in 1.0.12:
 *   - quarkus_open + quarkus_devui → quarkus_browser(target: 'app'|'devui')
 *   - quarkus_app_log_enable → quarkus_app_log(action: 'enable')
 *   - quarkus_update removed → remapped to quarkus_skills(query: 'quarkus-update')
 *
 * New in 1.0.12:
 *   - quarkus_start gains mavenProfiles parameter
 *   - /quarkus skills subcommand for managing installed community skills
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");

// ---------------------------------------------------------------------------
// A. Breaking fixes — quarkus_browser replaces quarkus_open / quarkus_devui
// ---------------------------------------------------------------------------

describe("quarkus_browser replaces quarkus_open and quarkus_devui", () => {
  it("TOOL_NAME['open'] maps to quarkus_browser", () => {
    const toolNameIdx = src.indexOf("const TOOL_NAME:");
    const block = src.slice(toolNameIdx, toolNameIdx + 600);
    assert.ok(
      block.match(/open\s*:\s*["']quarkus_browser["']/),
      `TOOL_NAME["open"] must be "quarkus_browser", got block:\n${block}`,
    );
  });

  it("TOOL_NAME['devui'] maps to quarkus_browser", () => {
    const toolNameIdx = src.indexOf("const TOOL_NAME:");
    const block = src.slice(toolNameIdx, toolNameIdx + 600);
    assert.ok(
      block.match(/devui\s*:\s*["']quarkus_browser["']/),
      `TOOL_NAME["devui"] must be "quarkus_browser", got block:\n${block}`,
    );
  });

  it("buildArgs('open', cwd) includes target: 'app'", () => {
    const buildArgsIdx = src.indexOf("function buildArgs(");
    assert.ok(buildArgsIdx >= 0, "buildArgs function not found");
    const block = src.slice(buildArgsIdx, buildArgsIdx + 800);
    assert.ok(
      block.includes(`sub === "open"`) || block.includes(`"open"`),
      `buildArgs must handle the "open" case`,
    );
    assert.ok(
      block.match(/target.*["']app["']/s) || block.match(/["']app["'].*target/s),
      `buildArgs must set target: "app" for "open"`,
    );
  });

  it("buildArgs('devui', cwd) includes target: 'devui'", () => {
    const buildArgsIdx = src.indexOf("function buildArgs(");
    assert.ok(buildArgsIdx >= 0, "buildArgs function not found");
    const block = src.slice(buildArgsIdx, buildArgsIdx + 800);
    assert.ok(
      block.includes(`sub === "devui"`) || block.includes(`"devui"`),
      `buildArgs must handle the "devui" case`,
    );
    assert.ok(
      block.match(/target.*["']devui["']/s) || block.match(/["']devui["'].*target/s),
      `buildArgs must set target: "devui" for "devui"`,
    );
  });

  it("quarkus_open no longer appears anywhere in source", () => {
    assert.ok(
      !src.includes("quarkus_open"),
      'source must not reference the removed "quarkus_open" tool',
    );
  });

  it("quarkus_devui no longer appears anywhere in source", () => {
    assert.ok(
      !src.includes("quarkus_devui"),
      'source must not reference the removed "quarkus_devui" tool',
    );
  });
});

// ---------------------------------------------------------------------------
// B. Breaking fix — quarkus_app_log_enable → quarkus_app_log(action='enable')
// ---------------------------------------------------------------------------

describe("quarkus_app_log_enable replaced by quarkus_app_log with action", () => {
  it("quarkus_app_log_enable no longer appears in source", () => {
    assert.ok(
      !src.includes("quarkus_app_log_enable"),
      'source must not call the removed "quarkus_app_log_enable" tool',
    );
  });

  it("app log enabling uses quarkus_app_log with action 'enable'", () => {
    // Find the site that previously called quarkus_app_log_enable
    // It should now call quarkus_app_log with action: "enable"
    assert.ok(
      src.includes(`"quarkus_app_log"`) || src.includes(`'quarkus_app_log'`),
      'source must call "quarkus_app_log"',
    );
    assert.ok(
      src.match(/quarkus_app_log.*action.*enable/s) || src.match(/action.*enable.*quarkus_app_log/s),
      'the quarkus_app_log call for enabling must pass action: "enable"',
    );
  });
});

// ---------------------------------------------------------------------------
// C. Breaking fix — quarkus_update removed, remapped to quarkus_skills
// ---------------------------------------------------------------------------

describe("quarkus_update remapped to quarkus_skills with query quarkus-update", () => {
  it("TOOL_NAME does not map 'update' to quarkus_update", () => {
    const toolNameIdx = src.indexOf("const TOOL_NAME:");
    const block = src.slice(toolNameIdx, toolNameIdx + 600);
    assert.ok(
      !block.match(/update\s*:\s*["']quarkus_update["']/),
      `TOOL_NAME["update"] must not point to the removed "quarkus_update" tool`,
    );
  });

  it("TOOL_NAME maps 'update' to quarkus_skills", () => {
    const toolNameIdx = src.indexOf("const TOOL_NAME:");
    const block = src.slice(toolNameIdx, toolNameIdx + 600);
    assert.ok(
      block.match(/update\s*:\s*["']quarkus_skills["']/),
      `TOOL_NAME["update"] must be "quarkus_skills"`,
    );
  });

  it("buildArgs('update', cwd) includes query: 'quarkus-update'", () => {
    const buildArgsIdx = src.indexOf("function buildArgs(");
    assert.ok(buildArgsIdx >= 0, "buildArgs function not found");
    const block = src.slice(buildArgsIdx, buildArgsIdx + 800);
    assert.ok(
      block.includes("quarkus-update"),
      `buildArgs must pass query: "quarkus-update" for the "update" subcommand`,
    );
  });

  it("TOOL_GUIDELINES no longer has a quarkus_update entry", () => {
    assert.ok(
      !src.includes("quarkus_update:"),
      'TOOL_GUIDELINES must not have a "quarkus_update" key (tool no longer exists)',
    );
  });

  it("TOOL_GUIDELINES quarkus_skills mentions quarkus-update query", () => {
    const guidelinesIdx = src.indexOf("TOOL_GUIDELINES");
    assert.ok(guidelinesIdx >= 0, "TOOL_GUIDELINES not found");
    const block = src.slice(guidelinesIdx, guidelinesIdx + 4000);
    const skillsIdx = block.indexOf("quarkus_skills:");
    assert.ok(skillsIdx >= 0, 'TOOL_GUIDELINES must have a "quarkus_skills" entry');
    const skillsBlock = block.slice(skillsIdx, skillsIdx + 600);
    assert.ok(
      skillsBlock.includes("quarkus-update"),
      `TOOL_GUIDELINES["quarkus_skills"] must mention the quarkus-update query`,
    );
  });
});

// ---------------------------------------------------------------------------
// D. New — mavenProfiles threaded through /quarkus start
// ---------------------------------------------------------------------------

describe("mavenProfiles parameter for /quarkus start", () => {
  it("buildArgs('start', cwd, 'myprofile') includes mavenProfiles", () => {
    const buildArgsIdx = src.indexOf("function buildArgs(");
    assert.ok(buildArgsIdx >= 0, "buildArgs function not found");
    const block = src.slice(buildArgsIdx, buildArgsIdx + 800);
    assert.ok(
      block.includes("mavenProfiles"),
      'buildArgs must include a mavenProfiles field for "start"',
    );
  });

  it("buildArgs('start', cwd) without extra does not set mavenProfiles", () => {
    // When extra is undefined/empty, mavenProfiles must not be passed
    // (so the MCP server uses its default, not an empty string)
    const buildArgsIdx = src.indexOf("function buildArgs(");
    assert.ok(buildArgsIdx >= 0, "buildArgs function not found");
    const block = src.slice(buildArgsIdx, buildArgsIdx + 800);
    // Must be conditional — either guarded by `extra &&`, `extra ?`, or similar
    assert.ok(
      block.match(/extra\s*&&.*mavenProfiles/s) ||
      block.match(/mavenProfiles.*extra/s) ||
      block.match(/extra\s*\?.*mavenProfiles/s),
      'mavenProfiles must only be set when extra is truthy',
    );
  });
});

// ---------------------------------------------------------------------------
// E. New — /quarkus skills subcommand
// ---------------------------------------------------------------------------

describe("/quarkus skills subcommand", () => {
  it("'skills' is in ALL_SUBCOMMANDS", () => {
    const allIdx = src.indexOf("ALL_SUBCOMMANDS    =");
    assert.ok(allIdx >= 0, "ALL_SUBCOMMANDS not found");
    const block = src.slice(allIdx, allIdx + 300);
    assert.ok(
      block.includes('"skills"'),
      `ALL_SUBCOMMANDS must include "skills"`,
    );
  });

  it("handler dispatches 'skills' to a handleSkills function", () => {
    assert.ok(
      src.includes("handleSkills"),
      'a "handleSkills" function must exist',
    );
    const handlerIdx = src.indexOf(`sub === "skills"`);
    assert.ok(
      handlerIdx >= 0,
      'the command handler must dispatch on sub === "skills"',
    );
    const dispatch = src.slice(handlerIdx, handlerIdx + 80);
    assert.ok(
      dispatch.includes("handleSkills"),
      `the skills dispatch must call handleSkills, got: ${dispatch}`,
    );
  });

  it("handleSkills calls quarkus_installSkills with list='true' to get remote skills", () => {
    const idx = src.indexOf("async function handleSkills(");
    assert.ok(idx >= 0, "handleSkills function not found");
    const block = src.slice(idx, idx + 1500);
    assert.ok(
      block.includes("quarkus_installSkills"),
      "handleSkills must call quarkus_installSkills",
    );
    assert.ok(
      block.match(/list.*["']true["']/s) || block.match(/["']true["'].*list/s),
      'handleSkills must pass list: "true" to quarkus_installSkills',
    );
  });

  it("handleSkills calls quarkus_skills to get installed skills", () => {
    const idx = src.indexOf("async function handleSkills(");
    assert.ok(idx >= 0, "handleSkills function not found");
    const block = src.slice(idx, idx + 1500);
    assert.ok(
      block.includes("quarkus_skills"),
      "handleSkills must call quarkus_skills",
    );
  });

  it("delete path removes the skill directory and notifies the LLM", () => {
    const idx = src.indexOf("async function handleSkills(");
    assert.ok(idx >= 0, "handleSkills function not found");
    const block = src.slice(idx, idx + 5000);
    assert.ok(
      block.includes("rm") || block.includes("unlink") || block.includes("rmdir"),
      "handleSkills delete path must remove a file/directory",
    );
    assert.ok(
      block.includes("sendUserMessage"),
      "handleSkills must call sendUserMessage after deleting a skill",
    );
  });

  it("install path calls quarkus_installSkills with the chosen skillName and notifies the LLM", () => {
    const idx = src.indexOf("async function handleSkills(");
    assert.ok(idx >= 0, "handleSkills function not found");
    const block = src.slice(idx, idx + 7000);
    assert.ok(
      block.includes("skillName"),
      "handleSkills install path must pass skillName to quarkus_installSkills",
    );
    assert.ok(
      block.includes("sendUserMessage"),
      "handleSkills must call sendUserMessage after installing a skill",
    );
  });
});
