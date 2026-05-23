/**
 * E2E Tier 1 — read-only, coarse assertions.
 *
 * Mission: catch JetBrains MCP drift (renamed tools, changed response shapes,
 * removed behaviours). NOT a regression suite for extension logic — unit tests
 * cover that.
 *
 * Run with:  npm run test:e2e
 * Never runs under `npm test`.
 * Never runs in CI.
 *
 * Prerequisites:
 *   1. IntelliJ IDEA running with the JetBrains MCP Server plugin enabled
 *   2. The tdder project open as an IDEA project
 * Failure messages guide the developer to fix the prerequisite — they are
 * beforeAll errors, not expect() assertions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { McpClient, type ToolCallResult } from "../../mcp-client.ts";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IDEA_BASE_URL = "http://127.0.0.1:64342";

// Two levels up from test/e2e/ → extensions/idea/ → extensions/ → repo root
const TDDER_ROOT = resolve(fileURLToPath(import.meta.url), "../../../..");

let client: McpClient;

beforeAll(async () => {
  const probe = new McpClient(IDEA_BASE_URL, TDDER_ROOT);

  // ── Condition 1 / 3: Is IDEA reachable and is the MCP plugin responding? ──
  try {
    await probe.connect();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ECONNREFUSED" || code === "ECONNRESET") {
      throw new Error(
        "IntelliJ IDEA does not appear to be running. " +
          "Run `/idea open` in pi to launch it with this project, " +
          "wait for indexing to finish, then re-run the tests.",
      );
    }
    // Connected but handshake failed → plugin missing or wrong protocol version.
    throw new Error(
      "The JetBrains MCP Server plugin is not responding correctly. " +
        "Install/enable it from the JetBrains Marketplace.",
    );
  }

  // ── Condition 2: Is the tdder project open? ──
  const moduleResult = await probe.callTool("get_project_modules", {});
  if (moduleResult.kind === "project-not-open") {
    const projectList = moduleResult.openProjects.join(", ") || "(none)";
    throw new Error(
      "IntelliJ IDEA is running but the tdder project is not open. " +
        "Run `/idea open` to open it (or use File → Open), then re-run. " +
        `Currently open: ${projectList}`,
    );
  }

  client = probe;
}, 15_000);

afterAll(async () => {
  await client?.close();
});

/** Coarse assertion: result is classified (not an exception), kind is "ok". */
function expectOk(result: ToolCallResult): void {
  expect(result.kind).toBe("ok");
}

// ── Tier 1: all 8 v0.1 explore/code tools, called against the tdder project ──
describe("explore/code tools — Tier 1 coarse assertions", () => {
  it("get_project_modules returns project info", async () => {
    const result = await client.callTool("get_project_modules", {});
    expectOk(result);
  });

  it("find_files_by_glob finds TypeScript files", async () => {
    const result = await client.callTool("find_files_by_glob", {
      globPattern: "**/*.ts",
    });
    expectOk(result);
  });

  it("list_directory_tree lists a known directory", async () => {
    const result = await client.callTool("list_directory_tree", {
      directoryPath: `${TDDER_ROOT}/extensions/idea`,
    });
    expectOk(result);
  });

  it("search_in_files_by_regex finds matches in source files", async () => {
    const result = await client.callTool("search_in_files_by_regex", {
      regexPattern: "McpClient",
      filePattern: "*.ts",
    });
    expectOk(result);
  });

  it("search_symbol finds a known symbol", async () => {
    const result = await client.callTool("search_symbol", {
      q: "McpClient",
    });
    expectOk(result);
  });

  it("get_symbol_info retrieves details for a known symbol", async () => {
    // get_symbol_info requires filePath + line; use a known location
    const result = await client.callTool("get_symbol_info", {
      filePath: `${TDDER_ROOT}/extensions/idea/mcp-client.ts`,
      line: 1,
    });
    expectOk(result);
  });

  it("read_file returns content of a known file", async () => {
    const result = await client.callTool("read_file", {
      path: `${TDDER_ROOT}/extensions/idea/index.ts`,
    });
    expectOk(result);
  });

  it("get_file_problems returns problem list for a known file", async () => {
    const result = await client.callTool("get_file_problems", {
      filePath: `${TDDER_ROOT}/extensions/idea/index.ts`,
    });
    expectOk(result);
  });
});

// ── Tier 1: v0.2 session tools, coarse assertions ──
describe("session tools — Tier 1 coarse assertions", () => {
  it("get_all_open_file_paths returns a list", async () => {
    const result = await client.callTool("get_all_open_file_paths", {});
    expectOk(result);
  });

  it("open_file_in_editor opens a known file without error", async () => {
    const result = await client.callTool("open_file_in_editor", {
      filePath: `${TDDER_ROOT}/extensions/idea/index.ts`,
    });
    expectOk(result);
  });
});

// ── Tier 1: v0.4 build/run tools, coarse assertions ──
describe("v0.4 build/run tools — Tier 1 coarse assertions", () => {
  it("build_project returns a build result", async () => {
    const result = await client.callTool("build_project", {});
    expectOk(result);
  });

  it("get_run_configurations returns a configuration list", async () => {
    const result = await client.callTool("get_run_configurations", {});
    expectOk(result);
  });

  // execute_run_configuration is intentionally omitted from the automated E2E suite:
  // it requires a human to click Allow in IDEA's security dialog, making it unfit for
  // unattended drift detection.
});

// ── Tier 1: v0.2-probe backfill tools (explore/code), coarse assertions ──
describe("backfill explore/code tools — Tier 1 coarse assertions", () => {
  it("get_project_dependencies returns dependency info", async () => {
    const result = await client.callTool("get_project_dependencies", {});
    expectOk(result);
  });

  it("get_repositories returns repository info", async () => {
    const result = await client.callTool("get_repositories", {});
    expectOk(result);
  });

  it("get_file_text_by_path returns content for a known file", async () => {
    const result = await client.callTool("get_file_text_by_path", {
      pathInProject: "extensions/idea/index.ts",
    });
    expectOk(result);
  });
});
