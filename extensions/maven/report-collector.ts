import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ProjectNode } from "./project-info.ts";
import { parseSurefireReport, type FailedTest, type TestSummary } from "./report-parser.ts";
import type { TestScope } from "./maven-run.ts";

/**
 * Returns the relative paths (from projectRoot) of surefire/failsafe report
 * directories that exist on disk, walking the full module tree so that reports
 * in submodules are included.
 */
export function collectReportPaths(projectRoot: string, tree?: ProjectNode, testScope?: TestScope): string[] {
  const reportDirs = testScope === "failsafe"
    ? ["target/failsafe-reports"]
    : testScope === "all"
      ? ["target/surefire-reports", "target/failsafe-reports"]
      : ["target/surefire-reports"];
  const dirs: string[] = [];

  function walk(node: ProjectNode) {
    for (const reportDir of reportDirs) {
      const candidate = node.relativePath === "."
        ? reportDir
        : join(node.relativePath, reportDir);
      if (existsSync(join(projectRoot, candidate))) dirs.push(candidate);
    }
    for (const child of Object.values(node.modules ?? {})) walk(child);
  }

  if (tree) {
    walk(tree);
  } else {
    // Fallback when no tree is available: check root only.
    for (const reportDir of reportDirs) {
      if (existsSync(join(projectRoot, reportDir))) dirs.push(reportDir);
    }
  }
  return dirs;
}

/**
 * Parses surefire/failsafe XML reports at the given paths and aggregates results.
 *
 * @param since  If provided, only report files modified at or after this timestamp
 *               (epoch ms) are included.  Files older than `since` are skipped,
 *               which filters out stale results from previous runs.
 */
export function parseReports(reportPaths: string[], projectRoot: string, since?: number): TestSummary {
  const summary: TestSummary = { testsRun: 0, failures: 0, errors: 0, skipped: 0, failedTests: [] };

  for (const rel of reportPaths) {
    const dir = join(projectRoot, rel);
    let xmlFiles: string[] = [];
    try { xmlFiles = readdirSync(dir).filter((f) => f.endsWith(".xml") && f.startsWith("TEST-")); }
    catch { continue; }

    for (const file of xmlFiles) {
      const filePath = join(dir, file);
      if (since !== undefined) {
        try {
          const mtime = statSync(filePath).mtimeMs;
          if (mtime < since) continue;
        } catch { continue; }
      }
      const xml = readFileSync(filePath, "utf8");
      const parsed = parseSurefireReport(xml);
      summary.testsRun += parsed.testsRun;
      summary.failures += parsed.failures;
      summary.errors += parsed.errors;
      summary.skipped += parsed.skipped;
      summary.failedTests.push(...parsed.failedTests.map((t) => ({ ...t, reportFile: join(rel, file) })));
    }
  }
  return summary;
}
