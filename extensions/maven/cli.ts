#!/usr/bin/env tsx
/**
 * Maven CLI for coding agents
 *
 * Provides the same structured Maven execution as the pi extension,
 * but as a standalone CLI that any agent can call via bash.
 *
 * Commands:
 *   info                                    – project detection and tree
 *   run test [--scope surefire|failsafe|all] [--selector <sel>] [--project <p>]
 *   run package [--project <p>]
 *   lookup-version <groupId> <artifactId> [--include-prereleases]
 */

import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { findProjectRoot, detectRunner, buildProjectTree, stripInternalFields, resolveCurrentProject } from "./project-info.ts";
import { buildMavenArgs, buildMavenCommand, buildMavenEnv, type MavenAction, type TestScope } from "./maven-run.ts";
import { collectReportPaths, parseReports } from "./report-collector.ts";
import { extractCompilationErrors, extractBuildErrors } from "./report-parser.ts";
import { saveRawLog } from "./log-store.ts";
import { buildMetadataUrl, fetchMetadata, selectVersion } from "./version-lookup.ts";
import { formatProjectInfo } from "./formatter.ts";
import type { ProjectInfoJson } from "./formatter.ts";
import type { ProjectNode } from "./project-info.ts";
import type { MavenProjectInfo, MavenRunResult, VersionLookupResult } from "./types.ts";

// ---------------------------------------------------------------------------
// Project info helpers (shared with index.ts)
// ---------------------------------------------------------------------------

function buildProjectInfoJson(info: MavenProjectInfo): ProjectInfoJson {
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

function getMavenProjectInfo(cwd: string): MavenProjectInfo | null {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) return null;

  const runner = detectRunner(projectRoot);
  const projectTree = buildProjectTree(projectRoot);
  const currentProject = resolveCurrentProject(projectTree, projectRoot, cwd);

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

// ---------------------------------------------------------------------------
// Maven runner (simplified — no pi widget, just spawn and collect output)
// ---------------------------------------------------------------------------

async function runMaven(
  args: string[],
  projectRoot: string,
): Promise<{ rawOutput: string; exitCode: number }> {
  const rawChunks: string[] = [];

  return new Promise((done) => {
    const [cmd, ...spawnArgs] = args;
    const child = spawn(cmd, spawnArgs, {
      cwd: projectRoot,
      env: buildMavenEnv(projectRoot),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const onData = (chunk: Buffer) => {
      rawChunks.push(chunk.toString());
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      done({ rawOutput: rawChunks.join(""), exitCode: code ?? 1 });
    });
  });
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { command: string; args: Record<string, string | boolean> } {
  const [command, ...rest] = argv;
  const args: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  args._positional = positional.join(" ");
  return { command: command ?? "", args };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdInfo(): Promise<void> {
  const cwd = resolve(process.cwd());
  const info = getMavenProjectInfo(cwd);

  if (!info) {
    const result = { isMavenProject: false };
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return;
  }

  const json = buildProjectInfoJson(info);
  console.log(JSON.stringify(json, null, 2));
}

async function cmdRun(args: Record<string, string | boolean>): Promise<void> {
  const cwd = resolve(process.cwd());
  const info = getMavenProjectInfo(cwd);
  if (!info) {
    console.error("Not a Maven project");
    process.exitCode = 1;
    return;
  }

  const action = (args._positional as string) || "";
  if (!["test", "package"].includes(action)) {
    console.error(`Usage: tdder-maven run <test|package> [--scope surefire|failsafe|all] [--selector <sel>] [--project <p>]`);
    process.exitCode = 1;
    return;
  }

  const testScope = (args.scope as TestScope | undefined);
  const selector = args.selector as string | undefined;
  const project = (args.project as string | undefined)
    ?? (info.currentProject?.relativePath !== "." ? info.currentProject?.relativePath : undefined);

  if (action === "test" && !testScope) {
    console.error("--scope is required for 'test' action: surefire, failsafe, or all");
    process.exitCode = 1;
    return;
  }

  if (action === "test" && testScope === "failsafe") {
    const pomContent = existsSync(info.pomPath) ? readFileSync(info.pomPath, "utf8") : "";
    if (!pomContent.includes("skip.surefire.tests")) {
      console.log(JSON.stringify({
        error: "SUREFIRE_SKIP_NOT_CONFIGURED",
        message: "The project POM does not define a 'skip.surefire.tests' property wired to Surefire's <skip> configuration. Add it to the POM before running with --scope failsafe, or use --scope all to run both Surefire and Failsafe.",
      }, null, 2));
      process.exitCode = 1;
      return;
    }
  }

  const opts = { action: action as MavenAction, runner: info.runner, selector, project, testScope };
  const command = buildMavenCommand(opts);
  const mavenArgs = buildMavenArgs(opts);

  let { rawOutput, exitCode } = await runMaven(mavenArgs, info.projectRoot);
  if (exitCode !== 0 && /resolver-status\.properties.*Operation not permitted/.test(rawOutput)) {
    ({ rawOutput, exitCode } = await runMaven([...mavenArgs, "-o"], info.projectRoot));
  }
  const rawMavenOut = saveRawLog(info.projectRoot, action, rawOutput);
  const success = exitCode === 0;

  const reportPaths = collectReportPaths(info.projectRoot, info.projectTree, testScope);
  const testSummary = parseReports(reportPaths, info.projectRoot);
  const compilationErrors = extractCompilationErrors(rawOutput);
  const buildErrors = extractBuildErrors(rawOutput);

  const result: MavenRunResult = {
    success,
    cwd,
    command,
    action,
    testSummary,
    failedTests: testSummary.failedTests,
    compilationErrors,
    buildErrors,
    reportPaths,
    rawMavenOut,
  };

  console.log(JSON.stringify(result, null, 2));
  if (!success) process.exitCode = 1;
}

async function cmdLookupVersion(args: Record<string, string | boolean>): Promise<void> {
  const positional = (args._positional as string || "").split(/\s+/);
  const groupId = positional[0];
  const artifactId = positional[1];

  if (!groupId || !artifactId) {
    console.error("Usage: tdder-maven lookup-version <groupId> <artifactId> [--include-prereleases]");
    process.exitCode = 1;
    return;
  }

  const includePrereleases = !!args["include-prereleases"];
  const metadataUrl = buildMetadataUrl(groupId, artifactId);

  const { latestVersion, versions } = await fetchMetadata(groupId, artifactId);
  const { selectedVersion, prereleaseFiltered } = selectVersion(latestVersion, versions, includePrereleases);

  const result: VersionLookupResult = {
    groupId,
    artifactId,
    latestVersion,
    selectedVersion,
    prereleaseFiltered,
    metadataUrl,
  };

  console.log(JSON.stringify(result, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const USAGE = `Usage: tdder-maven <command>

Commands:
  info                                         Project structure and module tree
  run test --scope <surefire|failsafe|all>     Run tests with structured output
           [--selector <class or class#method>]
           [--project <module-path>]
  run package [--project <module-path>]        Package without tests
  lookup-version <groupId> <artifactId>        Look up latest version on Maven Central
           [--include-prereleases]`;

async function main(): Promise<void> {
  const { command, args } = parseArgs(process.argv.slice(2));

  switch (command) {
    case "info":
      return cmdInfo();
    case "run":
      return cmdRun(args);
    case "lookup-version":
      return cmdLookupVersion(args);
    default:
      console.error(USAGE);
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exitCode = 1;
});
