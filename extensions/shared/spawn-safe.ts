/**
 * Shared safe spawn helper.
 *
 * `spawn()` from `node:child_process` always returns synchronously, but fires
 * an `'error'` event asynchronously when the OS cannot find the executable
 * (ENOENT) or when the process otherwise fails to start. With no `'error'`
 * listener attached, Node promotes the event to an uncaught exception and the
 * host process crashes.
 *
 * `spawnSafe` wraps `spawn` and attaches an `'error'` listener that rejects
 * a guard promise. That promise is raced against the caller-supplied work so
 * the rejection propagates naturally through async/await rather than crashing.
 *
 * Usage:
 *
 *   const { child, whenSpawnError } = spawnSafe("mvn", ["test"], opts);
 *   const result = await Promise.race([doWorkWith(child), whenSpawnError]);
 *
 * `whenSpawnError` never resolves — it only rejects — so `Promise.race` will
 * settle with the work result when the process starts successfully, or with
 * the ENOENT / spawn error when it fails.
 */

import { spawn, type SpawnOptionsWithoutStdio, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface SpawnSafeResult {
  child: ChildProcessWithoutNullStreams;
  /** A promise that only ever rejects (with the spawn error). Race against your work promise. */
  whenSpawnError: Promise<never>;
}

export function spawnSafe(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
): SpawnSafeResult {
  const child = spawn(command, args, options);
  const whenSpawnError = new Promise<never>((_resolve, reject) => {
    child.on("error", reject);
  });
  return { child, whenSpawnError };
}
