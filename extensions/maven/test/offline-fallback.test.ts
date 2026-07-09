import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  shouldRetryMavenOffline,
  spawnMavenWithOfflineFallback,
  type RawRunOutput,
  type SpawnMavenFn,
} from "../maven-project.ts";

describe("shouldRetryMavenOffline", () => {
  it("returns true for resolver-status.properties Operation not permitted failures", () => {
    const rawRun: RawRunOutput = {
      exitCode: 1,
      rawOutput: "[ERROR] Failed to write resolver-status.properties: Operation not permitted",
    };
    assert.equal(shouldRetryMavenOffline(rawRun), true);
  });

  it("returns false for successful runs", () => {
    const rawRun: RawRunOutput = {
      exitCode: 0,
      rawOutput: "[INFO] BUILD SUCCESS",
    };
    assert.equal(shouldRetryMavenOffline(rawRun), false);
  });

  it("returns false for unrelated Operation not permitted failures", () => {
    const rawRun: RawRunOutput = {
      exitCode: 1,
      rawOutput: "[ERROR] target/some-other-file: Operation not permitted",
    };
    assert.equal(shouldRetryMavenOffline(rawRun), false);
  });
});

describe("spawnMavenWithOfflineFallback", () => {
  it("returns the first run when no offline retry is needed", async () => {
    const calls: string[][] = [];
    const run: SpawnMavenFn = async (args) => {
      calls.push(args);
      return { exitCode: 0, rawOutput: "[INFO] BUILD SUCCESS" };
    };

    const result = await spawnMavenWithOfflineFallback(["./mvnw", "test"], "/project", undefined, run);

    assert.deepEqual(calls, [["./mvnw", "test"]]);
    assert.equal(result.exitCode, 0);
  });

  it("retries once with -o when resolver-status.properties is blocked", async () => {
    const calls: string[][] = [];
    const run: SpawnMavenFn = async (args) => {
      calls.push(args);
      if (calls.length === 1) {
        return {
          exitCode: 1,
          rawOutput: "[ERROR] Failed to write resolver-status.properties: Operation not permitted",
        };
      }
      return { exitCode: 0, rawOutput: "[INFO] BUILD SUCCESS" };
    };

    const result = await spawnMavenWithOfflineFallback(["./mvnw", "package"], "/project", undefined, run);

    assert.deepEqual(calls, [
      ["./mvnw", "package"],
      ["./mvnw", "package", "-o"],
    ]);
    assert.equal(result.exitCode, 0);
  });

  it("passes through onChunk to both attempts", async () => {
    const chunks: string[] = [];
    const run: SpawnMavenFn = async (args, _projectRoot, onChunk) => {
      onChunk?.(`[${args.join(" ")}]`);
      return args.includes("-o")
        ? { exitCode: 0, rawOutput: "[INFO] BUILD SUCCESS" }
        : { exitCode: 1, rawOutput: "[ERROR] Failed to write resolver-status.properties: Operation not permitted" };
    };

    await spawnMavenWithOfflineFallback(["./mvnw", "test"], "/project", (text) => chunks.push(text), run);

    assert.deepEqual(chunks, [
      "[./mvnw test]",
      "[./mvnw test -o]",
    ]);
  });
});
