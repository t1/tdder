#!/usr/bin/env tsx
/**
 * Maven CLI for coding agents
 *
 * Provides the same structured Maven execution as the pi extension,
 * but as a standalone CLI that any agent can call via bash.
 *
 * Commands:
 *   info                                    – project detection and tree
 *   test [--scope surefire|failsafe|all] [--profiles <ids>] [--selector <sel>] [--project <p>]
 *        [--property <k=v> | -Dk=v ...] [--offline]
 *   package [--project <p>] [--profiles <ids>] [--property <k=v> | -Dk=v ...] [--offline]
 *   lookup-version <groupId> <artifactId> [--include-prereleases]
 *   available-java-versions                 – Adoptium Java release info
 *
 * Version lookup applies equally to Maven dependencies and plugins.
 */

import {resolve} from "node:path";

import {buildMavenArgs, buildMavenCommand, parsePropertyTokens, type MavenAction, type TestScope} from "./maven-run.ts";
import {
  MavenProjectInfo,
  MavenRun,
  spawnMavenWithOfflineFallback,
  type MavenRunOptions,
} from "./maven-project.ts";
import {buildMetadataUrl, fetchMetadata, formatVersionLookupError, selectVersion, VersionLookupError} from "./version-lookup.ts";
import {fetchAvailableJavaVersions, fetchJavaReleaseMetadata, ADOPTIUM_AVAILABLE_RELEASES_URL} from "./java-version-lookup.ts";
import {INFO_LAYOUT, SUREFIRE_SKIP_NOT_CONFIGURED_MESSAGE} from "./guidance.ts";
import type {JavaVersionLookupJson, MavenRunJson, VersionLookupFailureJson, VersionLookupJson} from "./tool-types.ts";
import {toMavenRunJson, toProjectInfoJson} from "./tool-types.ts";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

/** Parsed CLI arguments: flags (string or boolean), with `property` as a repeatable string[]. */
type CliArgs = Record<string, string | boolean | string[]>;

export function checkUnknownFlags(
  args: CliArgs,
  known: string[],
): string | null {
  const knownSet = new Set(known);
  const unknown = Object.keys(args).filter((k) => k !== "_positional" && !knownSet.has(k));
  if (unknown.length === 0) return null;
  return `Unknown flag${unknown.length > 1 ? "s" : ""}: ${unknown.map((k) => `--${k}`).join(", ")}`;
}

export function parseArgs(argv: string[]): { command: string; args: CliArgs } {
  const [command, ...rest] = argv;
  const args: CliArgs = {};
  const positional: string[] = [];
  const properties: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    // Maven-native -Dkey=value syntax — collected like --property so it can't
    // get lost in the positional arguments.
    if (arg.startsWith("-D") && arg.length > 2) {
      properties.push(arg.slice(2));
      continue;
    }
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        if (arg.slice(2, eqIdx) === "property") properties.push(arg.slice(eqIdx + 1));
        else args[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = rest[i + 1];
        if (key === "property" && next && !next.startsWith("--")) {
          // Repeatable flag: collect every occurrence.
          properties.push(next);
          i++;
        } else if (next && !next.startsWith("--")) {
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
  if (properties.length > 0) args.property = properties;
  args._positional = positional.join(" ");
  return {command: command ?? "", args};
}

/** True when positional arguments were given (they are unexpected for run commands). */
function hasPositional(args: CliArgs): boolean {
  return typeof args._positional === "string" && args._positional.length > 0;
}

/** Report unexpected positional arguments with a non-zero exit code. */
function rejectPositional(args: CliArgs): void {
  const stray = args._positional;
  if (typeof stray === "string") {
    console.error(`Unexpected argument${stray.includes(" ") ? "s" : ""}: ${stray}`);
    process.exitCode = 1;
  }
}

/** Flags shared by the `test` and `package` commands. */
const RUN_FLAGS = ["selector", "project", "profiles", "update-snapshots", "offline", "property"];

/** Parse shared run-command flags into MavenCommandOptions fields. */
export function parseRunFlags(
  args: CliArgs,
  defaultProject: string | undefined,
): {
  selector: string | undefined;
  project: string | undefined;
  profiles: string[] | undefined;
  forceUpdate: boolean;
  offline: boolean;
  properties: Record<string, string>;
} {
  const profiles = typeof args.profiles === "string"
    ? args.profiles.split(",").map(profile => profile.trim()).filter(Boolean)
    : undefined;
  return {
    selector: args.selector as string | undefined,
    project: (args.project as string | undefined) ?? defaultProject,
    profiles,
    forceUpdate: args["update-snapshots"] === true,
    offline: args.offline === true,
    properties: parsePropertyTokens(args.property),
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdInfo(args: CliArgs): Promise<void> {
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

async function cmdTest(args: CliArgs): Promise<void> {
  const unknownError = checkUnknownFlags(args, [...RUN_FLAGS, "scope", "include-timings", "limit"]);
  if (unknownError) {
    console.error(unknownError);
    process.exitCode = 1;
    return;
  }
  if (hasPositional(args)) {
    rejectPositional(args);
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

  const includeTimings = args["include-timings"] === true;
  const rawLimit = args["limit"] as string | boolean | undefined;
  const limit: number | null =
    rawLimit === "none" ? null
      : rawLimit !== undefined && rawLimit !== true ? parseInt(rawLimit as string, 10)
        : 10;

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

  const base = parseRunFlags(args, info.defaultProject());
  const opts = { action: "test" as MavenAction, runner: info.runner, ...base, testScope };
  const command = buildMavenCommand(opts);
  const mavenArgs = buildMavenArgs(opts);

  const runStartTime = Date.now();
  const rawRun = await spawnMavenWithOfflineFallback(mavenArgs, info.projectRoot);

  const result = toMavenRunJson(MavenRun.fromRawOutput(rawRun, info, {command, action: "test", cwd, testScope, runStartTime, includeTimings, limit}));

  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
}

async function cmdPackage(args: CliArgs): Promise<void> {
  const unknownError = checkUnknownFlags(args, RUN_FLAGS);
  if (unknownError) {
    console.error(unknownError);
    process.exitCode = 1;
    return;
  }
  if (hasPositional(args)) {
    rejectPositional(args);
    return;
  }

  const cwd = resolve(process.cwd());
  const info = MavenProjectInfo.create(cwd);
  if (!info) {
    console.error("Not a Maven project");
    process.exitCode = 1;
    return;
  }

  const opts = { action: "package" as MavenAction, runner: info.runner, ...parseRunFlags(args, info.defaultProject()) };
  const command = buildMavenCommand(opts);
  const mavenArgs = buildMavenArgs(opts);

  const runStartTime = Date.now();
  const rawRun = await spawnMavenWithOfflineFallback(mavenArgs, info.projectRoot);

  const result = toMavenRunJson(MavenRun.fromRawOutput(rawRun, info, {command, action: "package", cwd, testScope: undefined, runStartTime}));

  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
}

async function cmdLookupVersion(args: CliArgs): Promise<void> {
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

  try {
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
  } catch (err) {
    if (err instanceof VersionLookupError) {
      const failure: VersionLookupFailureJson = { ...err.details };
      console.error(JSON.stringify(failure, null, 2));
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

async function cmdAvailableJavaVersions(args: CliArgs): Promise<void> {
  const unknownError = checkUnknownFlags(args, []);
  if (unknownError) {
    console.error(unknownError);
    process.exitCode = 1;
    return;
  }

  const versions = await fetchAvailableJavaVersions();
  const [latestFeatureMetadata, latestLtsMetadata] = await Promise.all([
    fetchJavaReleaseMetadata(versions.mostRecentFeatureRelease),
    fetchJavaReleaseMetadata(versions.mostRecentLts),
  ]);
  const result: JavaVersionLookupJson = {
    availableLtsReleases: versions.availableLtsReleases,
    availableReleases: versions.availableReleases,
    latestFeatureRelease: versions.mostRecentFeatureRelease,
    latestLtsRelease: versions.mostRecentLts,
    latestFeatureReleaseDate: latestFeatureMetadata.releaseDate,
    latestFeatureReleaseAgeDays: latestFeatureMetadata.ageDays,
    latestLtsReleaseDate: latestLtsMetadata.releaseDate,
    latestLtsReleaseAgeDays: latestLtsMetadata.ageDays,
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
  # Includes available profile ids from the root pom

  # Unit tests (Surefire)
  tdder-maven test --scope surefire

  # Acceptance-test profile
  tdder-maven test --scope all --profiles at

  # Force remote update checks for snapshots and metadata
  tdder-maven test --scope surefire --update-snapshots

  # Pass arbitrary user properties (-D syntax, like Maven itself)
  tdder-maven test --scope surefire -Dquarkus.test.tags=slow -DskipTests
  tdder-maven package --property native.enabled=true --property another=2

  # Run offline from the local repository only (no network; mutually exclusive with --update-snapshots)
  tdder-maven test --scope surefire --offline
  tdder-maven package --offline -Dnative.enabled

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

  # Package with Maven profiles
  tdder-maven package --profiles native

  # Package with forced snapshot/metadata refresh
  tdder-maven package --update-snapshots

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
