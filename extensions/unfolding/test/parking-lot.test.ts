/**
 * Tests for ParkingLot (in-process coordination between parent and child sessions)
 * and structural wiring of task tools to the parking lot.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ParkingLot } from "../parking-lot.ts";

// ---------------------------------------------------------------------------
// ParkingLot
// ---------------------------------------------------------------------------

describe("ParkingLot", () => {
  it("park(slug) returns a promise that resolves when release is called", async () => {
    const lot = new ParkingLot();
    let resolved = false;
    const p = lot.park("my-task").then(r => { resolved = true; return r; });
    // Not resolved yet
    await Promise.resolve(); // yield
    assert.equal(resolved, false);
    lot.release("my-task", "accepted");
    await p;
    assert.equal(resolved, true);
  });

  it("release with 'accepted' resolves the promise with 'accepted'", async () => {
    const lot = new ParkingLot();
    const p = lot.park("t1");
    lot.release("t1", "accepted");
    assert.equal(await p, "accepted");
  });

  it("release with 'in_progress' resolves the promise with 'in_progress'", async () => {
    const lot = new ParkingLot();
    const p = lot.park("t2");
    lot.release("t2", "in_progress");
    assert.equal(await p, "in_progress");
  });

  it("park on an already-parked slug throws", () => {
    const lot = new ParkingLot();
    lot.park("dup");
    assert.throws(() => lot.park("dup"), /dup/);
  });
});

// ---------------------------------------------------------------------------
// Structural wiring
// ---------------------------------------------------------------------------

describe("structural wiring", () => {
  it("task_finished tool parks after writing finished status", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
    const idx = src.indexOf('name: "task_finished"');
    assert.ok(idx >= 0);
    const block = src.slice(idx, idx + 500);
    assert.ok(block.includes("taskFinished"), "must call taskFinished");
    assert.ok(block.includes("park"), "must call parkingLot.park");
  });

  it("task_block tool parks after writing blocked status", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
    const idx = src.indexOf('name: "task_block"');
    assert.ok(idx >= 0);
    const block = src.slice(idx, idx + 500);
    assert.ok(block.includes("taskBlock"), "must call taskBlock");
    assert.ok(block.includes("park"), "must call parkingLot.park");
  });

  it("task_accept tool releases with accepted", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
    const idx = src.indexOf('name: "task_accept"');
    assert.ok(idx >= 0);
    const block = src.slice(idx, idx + 500);
    assert.ok(block.includes('"accepted"'), "must release with 'accepted'");
    assert.ok(block.includes("release"), "must call parkingLot.release");
  });

  it("task_reopen tool releases with in_progress", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
    const idx = src.indexOf('name: "task_reopen"');
    assert.ok(idx >= 0);
    const block = src.slice(idx, idx + 500);
    assert.ok(block.includes('"in_progress"'), "must release with 'in_progress'");
    assert.ok(block.includes("release"), "must call parkingLot.release");
  });

  it("task_unblock tool releases with in_progress", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
    const idx = src.indexOf('name: "task_unblock"');
    assert.ok(idx >= 0);
    const block = src.slice(idx, idx + 500);
    assert.ok(block.includes('"in_progress"'), "must release with 'in_progress'");
    assert.ok(block.includes("release"), "must call parkingLot.release");
  });
});

// ---------------------------------------------------------------------------
// task_delegate wiring
// ---------------------------------------------------------------------------

describe("task_delegate wiring", () => {
  it("errors when role agent file not found", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
    const idx = src.indexOf('name: "task_delegate"');
    assert.ok(idx >= 0);
    const block = src.slice(idx, idx + 1500);
    assert.ok(block.includes("loadAgentSystemPrompt"), "must call loadAgentSystemPrompt");
    assert.ok(
      block.includes("throw") || block.includes("isError"),
      "must throw or return error when agent file not found"
    );
  });

  it("creates task file and writes session_id after session starts", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
    const idx = src.indexOf('name: "task_delegate"');
    assert.ok(idx >= 0);
    const block = src.slice(idx, idx + 1500);
    assert.ok(block.includes("createTask"), "must call createTask");
    assert.ok(block.includes("session_id"), "must write session_id to task");
  });

  it("passes body + CHILD_FIXED_INSTRUCTION as initial message", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
    const idx = src.indexOf('name: "task_delegate"');
    assert.ok(idx >= 0);
    const block = src.slice(idx, idx + 1500);
    assert.ok(block.includes("CHILD_FIXED_INSTRUCTION"), "must append CHILD_FIXED_INSTRUCTION");
  });
});
