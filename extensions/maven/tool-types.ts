/**
 * LLM-contract types — the exact JSON shapes sent to the LLM as tool results.
 *
 * These types belong to the tool layer (index.ts / cli.ts), not the domain.
 * They are defined here so both the pi extension and the CLI can share them
 * without either depending on the other.
 */

import type { MavenRun, MavenProjectInfo } from "./maven-project.ts";
import { stripInternalFields } from "./project-info.ts";
import type { ProjectInfoJson } from "./formatter.ts";
import type { FailedTest, TestSummary, TestTiming } from "./report-parser.ts";

export type { ProjectInfoJson };
export type { FailedTest, TestSummary, TestTiming };

export interface MavenRunJson {
  success: boolean;
  cwd: string;
  command: string;
  testSummary: TestSummary;
  failedTests: FailedTest[];
  failedTestsLimit?: number;
  testTimings?: TestTiming[];
  compilationErrors?: string[];
  buildErrors?: string[];
  rawMavenLogPath: string;
}

export interface VersionLookupJson {
  groupId: string;
  artifactId: string;
  latestVersion: string;
  selectedVersion: string;
  prereleaseFiltered: boolean;
  metadataUrl: string;
}

export interface VersionLookupFailureJson {
  groupId: string;
  artifactId: string;
  metadataUrl: string;
  cause: "coordinates_not_found" | "network_problem" | "upstream_http_error";
  status?: number;
  initialStatus?: number;
  probeUrl?: string;
  probeStatus?: number;
  retryStatus?: number;
}

export interface JavaVersionLookupJson {
  availableLtsReleases: number[];
  availableReleases: number[];
  latestFeatureRelease: number;
  latestLtsRelease: number;
  latestFeatureReleaseDate: string;
  latestFeatureReleaseAgeDays: number;
  latestLtsReleaseDate: string;
  latestLtsReleaseAgeDays: number;
  metadataUrl: string;
}

export function toMavenRunJson(run: MavenRun): MavenRunJson {
  return {
    success: run.success,
    cwd: run.cwd,
    command: run.command,
    testSummary: { ...run.testSummary, ...(run.totalOnDisk !== undefined ? { totalOnDisk: run.totalOnDisk } : {}) },
    failedTests: run.failedTests,
    ...(run.failedTestsLimit !== undefined ? { failedTestsLimit: run.failedTestsLimit } : {}),
    ...(run.testTimings ? { testTimings: run.testTimings } : {}),
    ...(run.compilationErrors.length > 0 ? { compilationErrors: run.compilationErrors } : {}),
    ...(run.buildErrors.length > 0 ? { buildErrors: run.buildErrors } : {}),
    rawMavenLogPath: run.rawMavenLogPath,
  };
}

export function toProjectInfoJson(info: MavenProjectInfo): ProjectInfoJson {
  const { modules, ...rootFields } = stripInternalFields(info.projectTree);
  return {
    isMavenProject: true,
    rootPath: info.projectRoot,
    runner: info.runner,
    currentPath: info.currentProject?.relativePath ?? ".",
    profiles: info.profiles,
    ...rootFields,
    ...(modules ? { modules } : {}),
  };
}
