import type { ProjectNode } from "./project-info.ts";
import type { FailedTest, TestSummary, TestTiming } from "./report-parser.ts";

export type { ProjectNode, FailedTest, TestSummary, TestTiming };

export interface MavenProjectInfo {
  isMavenProject: boolean;
  projectRoot: string;
  pomPath: string;
  runner: string;
  currentProject: ProjectNode | null; // internal; serialised as currentPath
  projectTree: ProjectNode;
}

export interface MavenRunResult {
  success: boolean;
  cwd: string;
  command: string;
  testSummary: TestSummary;
  failedTests: FailedTest[];
  failedTestsLimit?: number;
  testTimings?: TestTiming[];
  compilationErrors?: string[];
  buildErrors?: string[];
  rawMavenOut: string;
}

export interface VersionLookupResult {
  groupId: string;
  artifactId: string;
  latestVersion: string;
  selectedVersion: string;
  prereleaseFiltered: boolean;
  metadataUrl: string;
}
