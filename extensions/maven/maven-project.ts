import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { findProjectRoot, detectRunner, buildProjectTree, resolveCurrentProject, stripInternalFields } from "./project-info.ts";
import { collectReportPaths, parseReports } from "./report-collector.ts";
import { extractCompilationErrors, extractBuildErrors } from "./report-parser.ts";
import { saveRawLog } from "./log-store.ts";
import { formatProjectInfo } from "./formatter.ts";
import type { ProjectInfoJson } from "./formatter.ts";
import type { MavenProjectInfo, MavenRunResult } from "./types.ts";
import type { TestScope } from "./maven-run.ts";

// ---------------------------------------------------------------------------
// Project info
// ---------------------------------------------------------------------------

export function getMavenProjectInfo(cwd: string): MavenProjectInfo | null {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) return null;

  const runner = detectRunner(projectRoot);
  const projectTree = buildProjectTree(projectRoot);
  const currentProject = resolveCurrentProject(projectTree, projectRoot, cwd);

  // Omit children from currentProject — it's a flat coordinate record in the output,
  // not a subtree. The full tree is already in projectTree.
  const currentProjectFlat = currentProject
    ? (({ modules: _, ...rest }) => rest)(currentProject)
    : null;

  return {
    isMavenProject: true,
    projectRoot,
    pomPath: join(projectRoot, "pom.xml"),
    runner,
    currentProject: currentProjectFlat,
    projectTree,
  };
}

export function buildProjectInfoJson(info: MavenProjectInfo): ProjectInfoJson {
  const { pomPath: _, projectTree, projectRoot, currentProject, ...infoRest } = info;
  const { modules, ...rootFields } = stripInternalFields(projectTree);
  return {
    ...infoRest,
    rootPath: projectRoot,
    currentPath: currentProject?.relativePath ?? ".",
    ...rootFields,
    ...(modules ? { modules } : {}),
  };
}

export function buildProjectInfoResult(cwd: string): ProjectInfoJson & { isMavenProject: boolean } {
  const info = getMavenProjectInfo(cwd);
  if (!info) return { isMavenProject: false } as ProjectInfoJson & { isMavenProject: boolean };
  return buildProjectInfoJson(info);
}

export { formatProjectInfo };

// ---------------------------------------------------------------------------
// Run result assembly
// ---------------------------------------------------------------------------

export interface RawRunOutput {
  rawOutput: string;
  exitCode: number;
}

export function buildRunResult(
  { rawOutput, exitCode }: RawRunOutput,
  info: MavenProjectInfo,
  command: string,
  action: string,
  cwd: string,
  testScope: TestScope | undefined,
  runStartTime: number,
  options?: { includeTimings?: boolean },
): MavenRunResult {
  const rawMavenOut = saveRawLog(info.projectRoot, action, rawOutput);
  const success = exitCode === 0;

  const reportPaths = collectReportPaths(info.projectRoot, info.projectTree, testScope);
  const { summary: testSummary, failedTests, testTimings } = parseReports(reportPaths, info.projectRoot, runStartTime, options);
  const { summary: totalOnDiskSummary } = parseReports(reportPaths, info.projectRoot);
  const compilationErrors = extractCompilationErrors(rawOutput);
  const buildErrors = extractBuildErrors(rawOutput);

  const totalOnDisk = totalOnDiskSummary.testsRun !== testSummary.testsRun
    ? totalOnDiskSummary.testsRun
    : undefined;

  return {
    success,
    cwd,
    command,
    testSummary: { ...testSummary, ...(totalOnDisk !== undefined ? { totalOnDisk } : {}) },
    failedTests,
    ...(testTimings ? { testTimings } : {}),
    ...(compilationErrors.length > 0 ? { compilationErrors } : {}),
    ...(buildErrors.length > 0 ? { buildErrors } : {}),
    rawMavenOut,
  };
}

// ---------------------------------------------------------------------------
// Failsafe pre-check
// ---------------------------------------------------------------------------

export function checkSurefireSkipConfigured(pomPath: string): boolean {
  const pomContent = existsSync(pomPath) ? readFileSync(pomPath, "utf8") : "";
  return pomContent.includes("skip.surefire.tests");
}
