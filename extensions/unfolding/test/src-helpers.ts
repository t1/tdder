import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

export function loadIndexSrc(): string {
  return readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
}

export function blockAfter(src: string, marker: string, len = 600): string {
  const idx = src.indexOf(marker);
  assert.ok(idx >= 0, `marker not found: ${marker}`);
  return src.slice(idx, idx + len);
}

/** Extract the full tool registration block starting at marker, up to the next pi.registerTool call. */
export function toolBlock(src: string, marker: string): string {
  const idx = src.indexOf(marker);
  assert.ok(idx >= 0, `marker not found: ${marker}`);
  const next = src.indexOf("pi.registerTool", idx + marker.length);
  return next >= 0 ? src.slice(idx, next) : src.slice(idx);
}
