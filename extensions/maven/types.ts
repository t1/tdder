import type { ProjectNode } from "./project-info.ts";
import type { FailedTest, TestSummary } from "./report-parser.ts";

export type { ProjectNode, FailedTest, TestSummary };

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
  action: string;
  testSummary: TestSummary;
  failedTests: FailedTest[];
  compilationErrors: string[];
  buildErrors: string[];
  reportPaths: string[];
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
