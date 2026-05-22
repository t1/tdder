/**
 * Tests for the test-affected / test-all subcommand split.
 *
 * The old "/quarkus test" subcommand silently ran devui-testing_runAffectedTests
 * while the README said "Run tests", implying a full run. The fix:
 *   - rename "test" → "test-affected" (runs affected tests only)
 *   - add    "test-all"               (runs the full test suite)
 *   - remove the dead "test" entry from TOOL_NAME and buildArgs
 *   - include both in ALL_SUBCOMMANDS so they appear in tab-completion
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");

describe("test subcommand split", () => {
  it("ALL_SUBCOMMANDS contains test-affected", () => {
    // ALL_SUBCOMMANDS spreads TEST_SUBCOMMANDS which defines test-affected
    assert.ok(
      src.includes('"test-affected"'),
      'source must include "test-affected" (in TEST_SUBCOMMANDS spread into ALL_SUBCOMMANDS)',
    );
    // Confirm TEST_SUBCOMMANDS is spread into ALL_SUBCOMMANDS
    const allIdx = src.indexOf("ALL_SUBCOMMANDS    =");
    const allLine = src.slice(allIdx, allIdx + 150);
    assert.ok(allLine.includes("TEST_SUBCOMMANDS"), `ALL_SUBCOMMANDS must spread TEST_SUBCOMMANDS, got: ${allLine}`);
  });

  it("ALL_SUBCOMMANDS contains test-all", () => {
    assert.ok(
      src.includes('"test-all"'),
      'source must include "test-all" (in TEST_SUBCOMMANDS spread into ALL_SUBCOMMANDS)',
    );
  });

  it("ALL_SUBCOMMANDS does not contain the bare 'test' subcommand", () => {
    const idx = src.indexOf("ALL_SUBCOMMANDS");
    const line = src.slice(idx, idx + 200);
    // "test-affected" and "test-all" are fine; bare "test" (followed by quote or comma) is not
    assert.ok(
      !line.match(/"test"[,\s]/),
      `ALL_SUBCOMMANDS must not contain bare "test" subcommand, got: ${line}`,
    );
  });

  it("TOOL_NAME does not have a dead 'test' entry", () => {
    const toolNameIdx = src.indexOf("const TOOL_NAME:");
    const block = src.slice(toolNameIdx, toolNameIdx + 400);
    assert.ok(
      !block.match(/^\s+test:\s/m),
      `TOOL_NAME must not have a bare "test" entry (it was dead code), got: ${block}`,
    );
  });

  it("buildArgs does not have a dead sub === 'test' branch", () => {
    const buildArgsIdx = src.indexOf("function buildArgs(");
    const block = src.slice(buildArgsIdx, buildArgsIdx + 400);
    assert.ok(
      !block.includes(`sub === "test"`),
      `buildArgs must not have a dead sub === "test" branch`,
    );
  });

  it("test-affected dispatches to devui-testing_runAffectedTests", () => {
    // The handler block must reference both "test-affected" and runAffectedTests.
    const handlerIdx = src.indexOf("TEST_SUBCOMMANDS as readonly");
    assert.ok(handlerIdx >= 0, "TEST_SUBCOMMANDS dispatch block not found");
    const handlerBlock = src.slice(handlerIdx, handlerIdx + 600);
    assert.ok(
      handlerBlock.includes("runAffectedTests"),
      `devui-testing_runAffectedTests must appear in the TEST_SUBCOMMANDS dispatch block`,
    );
  });

  it("test-all dispatches to devui-testing_runTests", () => {
    const handlerIdx = src.indexOf("TEST_SUBCOMMANDS as readonly");
    assert.ok(handlerIdx >= 0, "TEST_SUBCOMMANDS dispatch block not found");
    const handlerBlock = src.slice(handlerIdx, handlerIdx + 600);
    assert.ok(
      handlerBlock.includes("runTests"),
      `devui-testing_runTests must appear in the TEST_SUBCOMMANDS dispatch block`,
    );
  });
});
