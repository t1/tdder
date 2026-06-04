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

import { buildMavenArgs, buildMavenCommand, buildMavenEnv, type MavenAction, type TestScope } from "./maven-run.ts";
import { buildProjectInfoResult, buildRunResult, checkSurefireSkipConfigured, getMavenProjectInfo } from "./maven-project.ts";
import { buildMetadataUrl, fetchMetadata, selectVersion } from "./version-lookup.ts";
import type { VersionLookupResult } from "./types.ts";

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
  const json = buildProjectInfoResult(cwd);
  console.log(JSON.stringify(json, null, 2));
  if (!json.isMavenProject) process.exitCode = 1;
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
  const includeTimings = args["include-timings"] === true;
  const project = (args.project as string | undefined)
    ?? (info.currentProject?.relativePath !== "." ? info.currentProject?.relativePath : undefined);

  if (action === "test" && !testScope) {
    console.error("--scope is required for 'test' action: surefire, failsafe, or all");
    process.exitCode = 1;
    return;
  }

  if (action === "test" && testScope === "failsafe") {
    if (!checkSurefireSkipConfigured(info.pomPath)) {
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

  const runStartTime = Date.now();
  let rawRun = await runMaven(mavenArgs, info.projectRoot);
  if (rawRun.exitCode !== 0 && /resolver-status\.properties.*Operation not permitted/.test(rawRun.rawOutput)) {
    rawRun = await runMaven([...mavenArgs, "-o"], info.projectRoot);
  }

  const result = buildRunResult(rawRun, info, command, action, cwd, testScope, runStartTime, { includeTimings });

  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
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

const USAGE = `tdder-maven — structured Maven execution for coding agents
Outputs JSON to stdout. Exits non-zero on failure.
Never cd to a subdirectory — use --project instead.

Examples:

  # Project structure and module tree
  tdder-maven info

  # Unit tests (Surefire)
  tdder-maven run test --scope surefire

  # Unit tests with selector
  tdder-maven run test --scope surefire --selector 'MyTest#myMethod'

  # Integration tests only (Failsafe, skips Surefire)
  tdder-maven run test --scope failsafe

  # All tests (Surefire + Failsafe)
  tdder-maven run test --scope all

  # Tests in a specific module
  tdder-maven run test --scope surefire --project module-a

  # Include per-test timings (use when investigating slow tests)
  tdder-maven run test --scope surefire --include-timings

  # Package without tests
  tdder-maven run package

  # Package a specific module
  tdder-maven run package --project module-a

  # Look up latest stable version on Maven Central
  tdder-maven lookup-version org.assertj assertj-core

  # Include pre-releases (RC, milestone, alpha, beta)
  tdder-maven lookup-version io.quarkus quarkus-bom --include-prereleases

Scope values for 'run test':
  surefire   Unit tests only          (mvn test)
  failsafe   Integration tests only   (mvn verify -Dskip.surefire.tests=true -DskipITs=false)
  all        Unit + integration tests (mvn verify -DskipITs=false)

If --scope failsafe returns SUREFIRE_SKIP_NOT_CONFIGURED, the POM does not wire
skip.surefire.tests to Surefire's <skip>. Tell the user to add it before retrying.
Do NOT silently fall back to --scope all.`;

async function main(): Promise<void> {
  const { command, args } = parseArgs(process.argv.slice(2));

  switch (command) {
    case "help":
      console.log(USAGE);
      break;
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
