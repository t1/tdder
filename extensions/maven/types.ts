import type { FlatProjectNode, ProjectNode } from "./project-info.ts";
import type { FailedTest, TestSummary } from "./report-parser.ts";

export type { FlatProjectNode, ProjectNode, FailedTest, TestSummary };

/** Internal shape — projectTree retains tree structure for rendering/report collection. */
export interface MavenProjectInfo {
  isMavenProject: boolean;
  projectRoot: string;
  pomPath: string;
  runner: string;
  currentProject: Omit<ProjectNode, "modules"> | null;
  projectTree: ProjectNode;
}

/** JSON-serialisable shape — projectTree is a flat ordered array of nodes. */
export interface MavenProjectInfoJson extends Omit<MavenProjectInfo, "projectTree"> {
  projectTree: FlatProjectNode[];
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
