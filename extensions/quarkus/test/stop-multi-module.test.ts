/**
 * Tests for multi-module /quarkus stop handling.
 *
 * Desired behaviour:
 *   - `/quarkus stop` no longer blindly stops the cwd service.
 *   - When several managed instances exist, it is driven by quarkus_list.
 *   - The user can pick several services to stop.
 *   - `/quarkus stop service-a service-b` resolves module names from the list.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");

describe("multi-module /quarkus stop", () => {
  it("has a dedicated handleStopSubcommand helper", () => {
    assert.ok(
      src.includes("async function handleStopSubcommand"),
      "index.ts must define handleStopSubcommand for the special stop flow",
    );
  });

  it("dispatches 'stop' to handleStopSubcommand before the generic direct handler", () => {
    const idx = src.indexOf('if (sub === "stop")');
    assert.ok(idx >= 0, "command handler must special-case sub === \"stop\"");
    const block = src.slice(idx, idx + 220);
    assert.ok(
      block.includes("handleStopSubcommand"),
      `stop dispatch must call handleStopSubcommand, got:\n${block}`,
    );
  });

  it("uses the discovered service target list for stoppable instances", () => {
    const idx = src.indexOf("async function handleStopSubcommand");
    assert.ok(idx >= 0, "handleStopSubcommand not found");
    const block = src.slice(idx, idx + 900);
    assert.ok(
      block.includes("loadServiceTargets") || block.includes("quarkus_list"),
      `handleStopSubcommand must load the service target list, got:\n${block}`,
    );
  });

  it("resolves explicit stop targets by module name and relative module path", () => {
    const idx = src.indexOf("function resolveServiceTargets");
    assert.ok(idx >= 0, "resolveServiceTargets not found");
    const block = src.slice(idx, idx + 1200);
    assert.ok(
      block.includes("service.label === token"),
      `resolveServiceTargets must match module names, got:\n${block}`,
    );
    assert.ok(
      block.includes("service.relativeDir === token"),
      `resolveServiceTargets must match relative module paths, got:\n${block}`,
    );
  });

  it("offers a multi-select UI for stopping several services", () => {
    const idx = src.indexOf("async function selectInstancesToStop");
    assert.ok(idx >= 0, "selectInstancesToStop not found");
    const block = src.slice(idx, idx + 3200);
    assert.ok(
      block.includes("space toggle") || block.includes("Key.space"),
      `selectInstancesToStop must support multi-selection, got:\n${block}`,
    );
    assert.ok(
      block.includes("Stop Quarkus Services"),
      `selectInstancesToStop must present a picker UI, got:\n${block}`,
    );
  });
});
