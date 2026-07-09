import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { findProjectRoot, detectRunner, buildProjectTree, resolveCurrentProject, availableProfiles } from "./project-info.ts";
import type { ProjectNode } from "./project-info.ts";
import { collectReportPaths, parseReports } from "./report-collector.ts";
import { extractCompilationErrors, extractBuildErrors } from "./report-parser.ts";
import type { FailedTest, TestSummary, TestTiming } from "./report-parser.ts";
import { saveRawLog } from "./log-store.ts";
import { formatProjectInfo } from "./formatter.ts";
import type { TestScope } from "./maven-run.ts";
import { buildMavenEnv } from "./maven-run.ts";
import { spawnSafe } from "./vendor/spawn-safe.ts";

export { formatProjectInfo };

// ---------------------------------------------------------------------------
// MavenProjectInfo
// ---------------------------------------------------------------------------

export class MavenProjectInfo {
  readonly projectRoot: string;
  readonly pomPath: string;
  readonly runner: string;
  readonly profiles: string[];
  readonly currentProject: Omit<ProjectNode, "modules"> | null;
  readonly projectTree: ProjectNode;

  private constructor(
    projectRoot: string,
    runner: string,
    profiles: string[],
    projectTree: ProjectNode,
    currentProject: Omit<ProjectNode, "modules"> | null,
  ) {
    this.projectRoot = projectRoot;
    this.pomPath = join(projectRoot, "pom.xml");
    this.runner = runner;
    this.profiles = profiles;
    this.projectTree = projectTree;
    this.currentProject = currentProject;
  }

  static create(cwd: string): MavenProjectInfo | null {
    const projectRoot = findProjectRoot(cwd);
    if (!projectRoot) return null;

    const runner = detectRunner(projectRoot);
    const profiles = availableProfiles(projectRoot);
    const projectTree = buildProjectTree(projectRoot);
    const currentProject = resolveCurrentProject(projectTree, projectRoot, cwd);

    // Omit children from currentProject — it's a flat coordinate record in the output,
    // not a subtree. The full tree is already in projectTree.
    const currentProjectFlat = currentProject
      ? (({ modules: _, ...rest }) => rest)(currentProject)
      : null;

    return new MavenProjectInfo(projectRoot, runner, profiles, projectTree, currentProjectFlat);
  }

  /**
   * The submodule to target by default when the CWD is inside a submodule.
   * Returns undefined when CWD is at the project root (no -pl flag needed).
   */
  defaultProject(): string | undefined {
    return this.currentProject?.relativePath !== "." ? this.currentProject?.relativePath : undefined;
  }

  get surefireSkipIsConfigured(): boolean {
    const pomContent = existsSync(this.pomPath) ? readFileSync(this.pomPath, "utf8") : "";
    return pomContent.includes("skip.surefire.tests");
  }
}

// ---------------------------------------------------------------------------
// Spawn Maven and collect output
// ---------------------------------------------------------------------------

export interface RawRunOutput {
  rawOutput: string;
  exitCode: number;
}

export type SpawnMavenFn = (
  args: string[],
  projectRoot: string,
  onChunk?: (text: string) => void,
) => Promise<RawRunOutput>;

/**
 * Spawn Maven, stream stdout+stderr into a single string, and return the
 * combined output with the exit code.
 *
 * @param onChunk  Optional callback invoked with each raw text chunk as it
 *                 arrives.  Use this to drive live progress indicators.
 */
export async function spawnMaven(
  args: string[],
  projectRoot: string,
  onChunk?: (text: string) => void,
): Promise<RawRunOutput> {
  const rawChunks: string[] = [];

  return new Promise((done, reject) => {
    const [cmd, ...spawnArgs] = args;
    const { child, whenSpawnError } = spawnSafe(cmd, spawnArgs, {
      cwd: projectRoot,
      env: buildMavenEnv(projectRoot),
      stdio: [null, "pipe", "pipe"],
    });
    whenSpawnError.catch(reject);

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      rawChunks.push(text);
      onChunk?.(text);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      done({ rawOutput: rawChunks.join(""), exitCode: code ?? 1 });
    });
  });
}

export function shouldRetryMavenOffline({ rawOutput, exitCode }: RawRunOutput): boolean {
  return exitCode !== 0 && /resolver-status\.properties.*Operation not permitted/.test(rawOutput);
}

/**
 * Retry with Maven offline mode when the first run fails because writing
 * resolver-status.properties is blocked by the sandbox.
 */
export async function spawnMavenWithOfflineFallback(
  args: string[],
  projectRoot: string,
  onChunk?: (text: string) => void,
  run: SpawnMavenFn = spawnMaven,
): Promise<RawRunOutput> {
  const firstRun = await run(args, projectRoot, onChunk);
  if (!shouldRetryMavenOffline(firstRun)) return firstRun;
  return run([...args, "-o"], projectRoot, onChunk);
}

// ---------------------------------------------------------------------------
// MavenRun — encapsulates a single Maven invocation and its parsed results
// ---------------------------------------------------------------------------

export interface MavenRunOptions {
  command: string;
  action: string;
  cwd: string;
  testScope: TestScope | undefined;
  runStartTime: number;
  includeTimings?: boolean;
  limit?: number | null;
}

export class MavenRun {
  readonly success: boolean;
  readonly command: string;
  readonly action: string;
  readonly cwd: string;
  readonly rawMavenLogPath: string;
  readonly testSummary: TestSummary;
  readonly totalOnDisk: number | undefined;
  readonly failedTests: FailedTest[];
  readonly failedTestsLimit: number | undefined;
  readonly testTimings: TestTiming[] | undefined;
  readonly compilationErrors: string[];
  readonly buildErrors: string[];

  private constructor(
    success: boolean,
    command: string,
    action: string,
    cwd: string,
    rawMavenLogPath: string,
    testSummary: TestSummary,
    totalOnDisk: number | undefined,
    failedTests: FailedTest[],
    failedTestsLimit: number | undefined,
    testTimings: TestTiming[] | undefined,
    compilationErrors: string[],
    buildErrors: string[],
  ) {
    this.success = success;
    this.command = command;
    this.action = action;
    this.cwd = cwd;
    this.rawMavenLogPath = rawMavenLogPath;
    this.testSummary = testSummary;
    this.totalOnDisk = totalOnDisk;
    this.failedTests = failedTests;
    this.failedTestsLimit = failedTestsLimit;
    this.testTimings = testTimings;
    this.compilationErrors = compilationErrors;
    this.buildErrors = buildErrors;
  }

  static fromRawOutput(
    { rawOutput, exitCode }: RawRunOutput,
    info: MavenProjectInfo,
    opts: MavenRunOptions,
  ): MavenRun {
    const rawMavenLogPath = saveRawLog(info.projectRoot, opts.action, rawOutput);
    const success = exitCode === 0;

    const parseOptions = { includeTimings: opts.includeTimings, limit: opts.limit };
    const reportPaths = collectReportPaths(info.projectRoot, info.projectTree, opts.testScope);
    const { summary: testSummary, failedTests, testTimings } = parseReports(reportPaths, info.projectRoot, opts.runStartTime, parseOptions);
    const { summary: totalOnDiskSummary } = parseReports(reportPaths, info.projectRoot);
    const compilationErrors = extractCompilationErrors(rawOutput);
    const buildErrors = extractBuildErrors(rawOutput);

    const totalOnDisk = totalOnDiskSummary.testsRun !== testSummary.testsRun
      ? totalOnDiskSummary.testsRun
      : undefined;

    const limit = opts.limit !== undefined ? opts.limit : 10;
    const { failedTests: limitedFailedTests, failedTestsLimit } = applyFailedTestLimit(failedTests, limit);

    return new MavenRun(
      success,
      opts.command,
      opts.action,
      opts.cwd,
      rawMavenLogPath,
      testSummary,
      totalOnDisk,
      limitedFailedTests,
      failedTestsLimit,
      testTimings,
      compilationErrors,
      buildErrors,
    );
  }
}

export function applyFailedTestLimit(
  failedTests: FailedTest[],
  limit: number | null,
): { failedTests: FailedTest[]; failedTestsLimit?: number } {
  if (limit === null || failedTests.length <= limit) {
    return { failedTests };
  }
  return { failedTests: failedTests.slice(0, limit), failedTestsLimit: limit };
}
