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
 *   available-java-versions                 – Adoptium Java release info
 *
 * Version lookup applies equally to Maven dependencies and plugins.
 */

import {resolve} from "node:path";

import {buildMavenArgs, buildMavenCommand, type MavenAction, type TestScope} from "./maven-run.ts";
import {
  MavenProjectInfo,
  MavenRun,
  spawnMaven,
  type MavenRunOptions,
} from "./maven-project.ts";
import {buildMetadataUrl, fetchMetadata, selectVersion} from "./version-lookup.ts";
import {fetchAvailableJavaVersions, ADOPTIUM_AVAILABLE_RELEASES_URL} from "./java-version-lookup.ts";
import {INFO_LAYOUT, SUREFIRE_SKIP_NOT_CONFIGURED_MESSAGE} from "./guidance.ts";
import type {JavaVersionLookupJson, MavenRunJson, VersionLookupJson} from "./tool-types.ts";
import {toMavenRunJson, toProjectInfoJson} from "./tool-types.ts";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

export function checkUnknownFlags(
  args: Record<string, string | boolean>,
  known: string[],
): string | null {
  const knownSet = new Set(known);
  const unknown = Object.keys(args).filter((k) => k !== "_positional" && !knownSet.has(k));
  if (unknown.length === 0) return null;
  return `Unknown flag${unknown.length > 1 ? "s" : ""}: ${unknown.map((k) => `--${k}`).join(", ")}`;
}

export function parseArgs(argv: string[]): { command: string; args: Record<string, string | boolean> } {
  const [command, ...rest] = argv;
  const args: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        args[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = rest[i + 1];
        if (next && !next.startsWith("--")) {
          args[key] = next;
          i++;
        } else {
          args[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  args._positional = positional.join(" ");
  return {command: command ?? "", args};
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdInfo(args: Record<string, string | boolean>): Promise<void> {
  const unknownError = checkUnknownFlags(args, []);
  if (unknownError) {
    console.error(unknownError);
    process.exitCode = 1;
    return;
  }
  const cwd = resolve(process.cwd());
  const info = MavenProjectInfo.create(cwd);
  const json = info ? toProjectInfoJson(info) : { isMavenProject: false };
  console.log(JSON.stringify(json, null, 2));
  if (!info) process.exitCode = 1;
}

async function cmdTest(args: Record<string, string | boolean>): Promise<void> {
  const unknownError = checkUnknownFlags(args, ["scope", "selector", "project", "include-timings", "limit"]);
  if (unknownError) {
    console.error(unknownError);
    process.exitCode = 1;
    return;
  }

  const cwd = resolve(process.cwd());
  const info = MavenProjectInfo.create(cwd);
  if (!info) {
    console.error("Not a Maven project");
    process.exitCode = 1;
    return;
  }

  const testScope = (args.scope as TestScope | undefined);
  if (!testScope) {
    console.error("--scope is required: surefire, failsafe, or all");
    process.exitCode = 1;
    return;
  }

  const selector = args.selector as string | undefined;
  const includeTimings = args["include-timings"] === true;
  const rawLimit = args["limit"] as string | boolean | undefined;
  const limit: number | null =
    rawLimit === "none" ? null
      : rawLimit !== undefined && rawLimit !== true ? parseInt(rawLimit as string, 10)
        : 10;
  const project = (args.project as string | undefined) ?? info.defaultProject();

  if (testScope === "failsafe") {
    if (!info.surefireSkipIsConfigured) {
      console.log(JSON.stringify({
        error: "SUREFIRE_SKIP_NOT_CONFIGURED",
        message: SUREFIRE_SKIP_NOT_CONFIGURED_MESSAGE,
      }, null, 2));
      process.exitCode = 1;
      return;
    }
  }

  const opts = {action: "test" as MavenAction, runner: info.runner, selector, project, testScope};
  const command = buildMavenCommand(opts);
  const mavenArgs = buildMavenArgs(opts);

  const runStartTime = Date.now();
  let rawRun = await spawnMaven(mavenArgs, info.projectRoot);
  if (rawRun.exitCode !== 0 && /resolver-status\.properties.*Operation not permitted/.test(rawRun.rawOutput)) {
    rawRun = await spawnMaven([...mavenArgs, "-o"], info.projectRoot);
  }

  const result = toMavenRunJson(MavenRun.fromRawOutput(rawRun, info, {command, action: "test", cwd, testScope, runStartTime, includeTimings, limit}));

  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
}

async function cmdPackage(args: Record<string, string | boolean>): Promise<void> {
  const unknownError = checkUnknownFlags(args, ["project"]);
  if (unknownError) {
    console.error(unknownError);
    process.exitCode = 1;
    return;
  }

  const cwd = resolve(process.cwd());
  const info = MavenProjectInfo.create(cwd);
  if (!info) {
    console.error("Not a Maven project");
    process.exitCode = 1;
    return;
  }

  const project = (args.project as string | undefined) ?? info.defaultProject();

  const opts = {action: "package" as MavenAction, runner: info.runner, project};
  const command = buildMavenCommand(opts);
  const mavenArgs = buildMavenArgs(opts);

  const runStartTime = Date.now();
  let rawRun = await spawnMaven(mavenArgs, info.projectRoot);
  if (rawRun.exitCode !== 0 && /resolver-status\.properties.*Operation not permitted/.test(rawRun.rawOutput)) {
    rawRun = await spawnMaven([...mavenArgs, "-o"], info.projectRoot);
  }

  const result = toMavenRunJson(MavenRun.fromRawOutput(rawRun, info, {command, action: "package", cwd, testScope: undefined, runStartTime}));

  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
}

async function cmdLookupVersion(args: Record<string, string | boolean>): Promise<void> {
  const unknownError = checkUnknownFlags(args, ["include-prereleases"]);
  if (unknownError) {
    console.error(unknownError);
    process.exitCode = 1;
    return;
  }

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

  const {latestVersion, versions} = await fetchMetadata(groupId, artifactId);
  const {selectedVersion, prereleaseFiltered} = selectVersion(latestVersion, versions, includePrereleases);

  const result: VersionLookupJson = {
    groupId,
    artifactId,
    latestVersion,
    selectedVersion,
    prereleaseFiltered,
    metadataUrl,
  };

  console.log(JSON.stringify(result, null, 2));
}

async function cmdAvailableJavaVersions(args: Record<string, string | boolean>): Promise<void> {
  const unknownError = checkUnknownFlags(args, []);
  if (unknownError) {
    console.error(unknownError);
    process.exitCode = 1;
    return;
  }

  const versions = await fetchAvailableJavaVersions();
  const result: JavaVersionLookupJson = {
    availableLtsReleases: versions.availableLtsReleases,
    availableReleases: versions.availableReleases,
    latestFeatureRelease: versions.mostRecentFeatureRelease,
    latestLtsRelease: versions.mostRecentLts,
    metadataUrl: ADOPTIUM_AVAILABLE_RELEASES_URL,
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
  # Note: ${INFO_LAYOUT}

  # Unit tests (Surefire)
  tdder-maven test --scope surefire

  # Unit tests with selector
  tdder-maven test --scope surefire --selector 'MyTest#myMethod'

  # Integration tests only (Failsafe, skips Surefire)
  tdder-maven test --scope failsafe

  # All tests (Surefire + Failsafe)
  tdder-maven test --scope all

  # Tests in a specific module
  tdder-maven test --scope surefire --project module-a

  # Include per-test timings (use when investigating slow tests)
  tdder-maven test --scope surefire --include-timings

  # Limit number of failed tests reported (default: 10; use --limit=none for all)
  tdder-maven test --scope surefire --limit=5
  tdder-maven test --scope surefire --limit=none

  # Package without tests
  tdder-maven package

  # Package a specific module
  tdder-maven package --project module-a

  # Look up latest stable dependency or plugin version on Maven Central
  tdder-maven lookup-version org.assertj assertj-core

  # Include pre-releases (RC, milestone, alpha, beta) for a dependency or plugin
  tdder-maven lookup-version io.quarkus quarkus-bom --include-prereleases

  # Show available Java versions from Adoptium
  tdder-maven available-java-versions

Scope values for 'test':
  surefire   Unit tests only          (mvn test)
  failsafe   Integration tests only   (mvn verify -Dskip.surefire.tests=true -DskipITs=false)
  all        Unit + integration tests (mvn verify -DskipITs=false)

If --scope failsafe returns SUREFIRE_SKIP_NOT_CONFIGURED, follow the instructions in the error response.

If the result contains failedTestsLimit, the failedTests list is capped at that number — there may be more failures. If you need all details in a single pass, rerun with --limit=none.

Each entry in failedTests has: kind (failure=assertion, error=unexpected exception), type (exception class), reportFile (relative path to the Surefire XML), reportFileOffset (1-based start line), and reportFileLimit (line count of the block). Read reportFile with reportFileOffset and reportFileLimit to get the full stacktrace or assertion diff.`;

async function main(): Promise<void> {
  const {command, args} = parseArgs(process.argv.slice(2));

  switch (command) {
    case "help":
      console.log(USAGE);
      break;
    case "info":
      return cmdInfo(args);
    case "test":
      return cmdTest(args);
    case "package":
      return cmdPackage(args);
    case "lookup-version":
      return cmdLookupVersion(args);
    case "available-java-versions":
      return cmdAvailableJavaVersions(args);
    default:
      console.error(USAGE);
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exitCode = 1;
});

export {main};
