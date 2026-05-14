import type { ProjectNode } from "./project-info.ts";

export interface ProjectInfoContext {
  projectRoot: string;
  runner: string;
  projectTree: ProjectNode;
  currentProject: ProjectNode | null;
}

// ---------------------------------------------------------------------------
// Plain-text formatting (used by unit tests and as the basis for themed output)
// ---------------------------------------------------------------------------

export function formatProjectInfo(ctx: ProjectInfoContext | null): string {
  if (!ctx) return "Not a Maven project";

  const { projectRoot, runner, projectTree, currentProject } = ctx;
  const lines: string[] = [
    "Maven project",
    `root:    ${projectRoot}`,
    `runner:  ${runner}`,
    `current: ${currentProject?.relativePath ?? "."}`,
    "projects:",
  ];

  renderNode(projectTree, 0, currentProject, lines);

  return lines.join("\n");
}

function renderNode(
  node: ProjectNode,
  depth: number,
  current: ProjectNode | null,
  lines: string[]
): void {
  const indent = "  ".repeat(depth);
  const isCurrent = current !== null && node.relativePath === current.relativePath;
  const marker = isCurrent ? " [current]" : "";
  const label = node.name ? `${node.artifactId} (${node.name})` : node.artifactId;
  lines.push(`${indent}- ${label}${marker}`);
  for (const child of Object.values(node.modules ?? {})) {
    renderNode(child, depth + 1, current, lines);
  }
}
