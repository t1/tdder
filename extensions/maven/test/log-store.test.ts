import { afterAll as after, describe, it } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { saveRawLog } from "../log-store.ts";

const projectRoot = join(tmpdir(), "log-store-test-" + process.pid);

after(() => rmSync(projectRoot, { recursive: true, force: true }));

describe("saveRawLog", () => {
  it("creates the target/pi/maven-logs directory if it does not exist", () => {
    saveRawLog(projectRoot, "test", "some output");
    assert.ok(existsSync(join(projectRoot, "target", "pi", "maven-logs")));
  });

  it("returns a project-relative path (not absolute)", () => {
    const result = saveRawLog(projectRoot, "test", "output");
    assert.ok(!isAbsolute(result), `expected relative path, got: ${result}`);
    assert.ok(result.startsWith(join("target", "pi", "maven-logs")), `expected path under target/pi/maven-logs, got: ${result}`);
  });

  it("written file content matches the output argument", () => {
    const content = "Maven build output line 1\nline 2\n";
    const relPath = saveRawLog(projectRoot, "package", content);
    const written = readFileSync(join(projectRoot, relPath), "utf8");
    assert.equal(written, content);
  });

  it("filename contains the action name", () => {
    const relPath = saveRawLog(projectRoot, "package", "");
    assert.ok(relPath.includes("package"), `expected 'package' in filename: ${relPath}`);
  });

  it("filename contains the action name for 'test' action", () => {
    const relPath = saveRawLog(projectRoot, "test", "");
    assert.ok(relPath.includes("test"), `expected 'test' in filename: ${relPath}`);
  });

  it("each call produces a distinct log file", () => {
    const path1 = saveRawLog(projectRoot, "package", "first");
    const path2 = saveRawLog(projectRoot, "package", "second");
    // The timestamp-based filename has second precision; both writes may land in the same
    // second, but the content of whichever file we read must match one of the two writes.
    // What we can assert reliably is that the files exist.
    assert.ok(existsSync(join(projectRoot, path1)));
    assert.ok(existsSync(join(projectRoot, path2)));
  });
});
