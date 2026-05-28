import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findJdtls, isJavaProject } from "../jdtls-server.ts";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

const mockExists = existsSync as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env["JDTLS_HOME"];
});

// ---------------------------------------------------------------------------
// isJavaProject
// ---------------------------------------------------------------------------

describe("isJavaProject", () => {
  it("returns true when pom.xml is present", () => {
    mockExists.mockImplementation((p: string) => p === "/proj/pom.xml");
    expect(isJavaProject("/proj")).toBe(true);
  });

  it("returns true when build.gradle is present", () => {
    mockExists.mockImplementation((p: string) => p === "/proj/build.gradle");
    expect(isJavaProject("/proj")).toBe(true);
  });

  it("returns true when build.gradle.kts is present", () => {
    mockExists.mockImplementation((p: string) => p === "/proj/build.gradle.kts");
    expect(isJavaProject("/proj")).toBe(true);
  });

  it("returns false when none of the markers are present", () => {
    mockExists.mockReturnValue(false);
    expect(isJavaProject("/proj")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findJdtls
// ---------------------------------------------------------------------------

describe("findJdtls", () => {
  beforeEach(() => {
    // Default: nothing exists unless the test overrides.
    mockExists.mockReturnValue(false);
  });

  it("returns null when jdtls is not installed anywhere", () => {
    expect(findJdtls()).toBeNull();
  });

  it("prefers JDTLS_HOME over all other locations", () => {
    process.env["JDTLS_HOME"] = "/custom/jdtls";
    mockExists.mockImplementation((p: string) => p === "/custom/jdtls/bin/jdtls");
    expect(findJdtls()).toBe("/custom/jdtls/bin/jdtls");
  });

  it("falls through to Homebrew Apple Silicon when JDTLS_HOME is absent", () => {
    mockExists.mockImplementation((p: string) => p === "/opt/homebrew/bin/jdtls");
    expect(findJdtls()).toBe("/opt/homebrew/bin/jdtls");
  });

  it("falls through to Homebrew Intel when Apple Silicon path is missing", () => {
    mockExists.mockImplementation((p: string) => p === "/usr/local/bin/jdtls");
    expect(findJdtls()).toBe("/usr/local/bin/jdtls");
  });

  it("falls through to Mason when Homebrew paths are missing", () => {
    const mason = join(homedir(), ".local", "share", "nvim", "mason", "bin", "jdtls");
    mockExists.mockImplementation((p: string) => p === mason);
    expect(findJdtls()).toBe(mason);
  });

  it("ignores JDTLS_HOME when the bin path does not exist", () => {
    process.env["JDTLS_HOME"] = "/nonexistent";
    // Only Homebrew path exists.
    mockExists.mockImplementation((p: string) => p === "/opt/homebrew/bin/jdtls");
    expect(findJdtls()).toBe("/opt/homebrew/bin/jdtls");
  });
});
