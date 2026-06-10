/**
 * Tests for multi-module targeting beyond /quarkus stop.
 *
 * Instance-aware commands should use discovered Quarkus services plus the
 * managed-instance list, rather than assuming the cwd is the target.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");

describe("service discovery helpers", () => {
  it("defines discoverQuarkusServices", () => {
    assert.ok(
      src.includes("function discoverQuarkusServices"),
      "index.ts must define discoverQuarkusServices",
    );
  });

  it("discoverQuarkusServices uses the shared Maven project tree", () => {
    const idx = src.indexOf("function discoverQuarkusServices");
    assert.ok(idx >= 0, "discoverQuarkusServices not found");
    const block = src.slice(idx, idx + 1200);
    assert.ok(
      block.includes("findProjectRoot") && block.includes("buildProjectTree"),
      `discoverQuarkusServices must use shared Maven tree helpers, got:\n${block}`,
    );
  });

  it("defines loadServiceTargets to overlay quarkus_list states on discovered services", () => {
    const idx = src.indexOf("async function loadServiceTargets");
    assert.ok(idx >= 0, "loadServiceTargets not found");
    const block = src.slice(idx, idx + 500);
    assert.ok(
      block.includes('callMcpTool("quarkus_list"') && block.includes("mergeServiceStates"),
      `loadServiceTargets must merge quarkus_list with discovered services, got:\n${block}`,
    );
  });
});

describe("status and start special handling", () => {
  it("defines handleStatusSubcommand", () => {
    assert.ok(src.includes("async function handleStatusSubcommand"), "handleStatusSubcommand must exist");
  });

  it("handleStatusSubcommand loads all service targets", () => {
    const idx = src.indexOf("async function handleStatusSubcommand");
    assert.ok(idx >= 0, "handleStatusSubcommand not found");
    const block = src.slice(idx, idx + 600);
    assert.ok(
      block.includes("loadServiceTargets(cwd)"),
      `handleStatusSubcommand must inspect all discovered services, got:\n${block}`,
    );
  });

  it("defines parseStartArgs and buildStartArgs", () => {
    assert.ok(src.includes("function parseStartArgs"), "parseStartArgs must exist");
    assert.ok(src.includes("function buildStartArgs"), "buildStartArgs must exist");
  });

  it("parseStartArgs supports --profiles=...", () => {
    const idx = src.indexOf("function parseStartArgs");
    assert.ok(idx >= 0, "parseStartArgs not found");
    const block = src.slice(idx, idx + 900);
    assert.ok(
      block.includes("--profiles="),
      `parseStartArgs must parse --profiles=..., got:\n${block}`,
    );
  });

  it("handleStartSubcommand chooses a discovered service target", () => {
    const idx = src.indexOf("async function handleStartSubcommand");
    assert.ok(idx >= 0, "handleStartSubcommand not found");
    const block = src.slice(idx, idx + 900);
    assert.ok(
      block.includes("loadServiceTargets(cwd)") && block.includes('chooseServiceTarget("start"'),
      `handleStartSubcommand must choose among discovered services, got:\n${block}`,
    );
  });

  it("command handler special-cases status and start before the generic direct handler", () => {
    const idx = src.indexOf('if (sub === "status")');
    assert.ok(idx >= 0, 'command handler must special-case sub === "status"');
    const block = src.slice(idx, idx + 260);
    assert.ok(block.includes("handleStatusSubcommand"), `status dispatch must call handleStatusSubcommand, got:\n${block}`);
    assert.ok(block.includes('if (sub === "start")'), `start dispatch must be special-cased too, got:\n${block}`);
    assert.ok(block.includes("handleStartSubcommand"), `start dispatch must call handleStartSubcommand, got:\n${block}`);
  });
});

describe("remaining instance-scoped command handlers", () => {
  it("handleDirectSubcommand resolves a discovered service target for direct instance commands", () => {
    const idx = src.indexOf("async function handleDirectSubcommand");
    assert.ok(idx >= 0, "handleDirectSubcommand not found");
    const block = src.slice(idx, idx + 1600);
    assert.ok(
      block.includes("INSTANCE_SCOPED_DIRECT_SUBCOMMANDS.has(sub)"),
      `handleDirectSubcommand must gate instance-scoped commands explicitly, got:\n${block}`,
    );
    assert.ok(
      block.includes("loadServiceTargets(cwd)") && block.includes("chooseServiceTarget(sub, cwd, ctx, extra, services)"),
      `handleDirectSubcommand must resolve the discovered service target, got:\n${block}`,
    );
  });

  it("handleInfo resolves a discovered service target before ensureDevMode", () => {
    const idx = src.indexOf("async function handleInfo");
    assert.ok(idx >= 0, "handleInfo not found");
    const block = src.slice(idx, idx + 1200);
    assert.ok(
      block.includes("loadServiceTargets(cwd)") && block.includes('chooseServiceTarget("info", cwd, ctx, extra, services)'),
      `handleInfo must resolve the target service, got:\n${block}`,
    );
  });

  it("handleTestSubcommand resolves a discovered service target before ensureDevMode", () => {
    const idx = src.indexOf("async function handleTestSubcommand");
    assert.ok(idx >= 0, "handleTestSubcommand not found");
    const block = src.slice(idx, idx + 1200);
    assert.ok(
      block.includes("loadServiceTargets(cwd)") && block.includes("chooseServiceTarget(sub, cwd, ctx, extra, services)"),
      `handleTestSubcommand must resolve the target service, got:\n${block}`,
    );
  });

  it("handleLlmSubcommand resolves a discovered service target for search-tools", () => {
    const idx = src.indexOf("async function handleLlmSubcommand");
    assert.ok(idx >= 0, "handleLlmSubcommand not found");
    const block = src.slice(idx, idx + 1400);
    assert.ok(
      block.includes('if (sub === "search-tools")'),
      `handleLlmSubcommand must special-case search-tools, got:\n${block}`,
    );
    assert.ok(
      block.includes("loadServiceTargets(cwd)") && block.includes("chooseServiceTarget(sub, cwd, ctx, undefined, services)"),
      `handleLlmSubcommand must resolve the search-tools service target, got:\n${block}`,
    );
  });
});
