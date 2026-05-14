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
  lines: string[],
  moduleKey?: string,
  parent?: ProjectNode,
): void {
  const indent = "  ".repeat(depth);
  const isCurrent = current !== null && node.relativePath === current.relativePath;
  const marker = isCurrent ? " [current]" : "";
  const label = formatLabel(node, moduleKey, parent);
  lines.push(`${indent}- ${label}${marker}`);
  for (const [key, child] of Object.entries(node.modules ?? {})) {
    renderNode(child, depth + 1, current, lines, key, node);
  }
}

export function formatLabel(node: ProjectNode, moduleKey: string | undefined, parent: ProjectNode | undefined): string {
  // The display key: module key for children, artifactId for the root
  const key = moduleKey ?? node.artifactId;

  const badges: string[] = [];

  // groupId: show when no parent (root) or when differs from parent's groupId
  if (!parent || node.groupId !== parent.groupId) {
    badges.push(node.groupId);
  }

  // artifactId: show when it differs from the module key
  if (node.artifactId !== key) {
    badges.push(node.artifactId);
  }

  // packaging: always shown
  badges.push(node.packaging);

  // version: show only when it differs from parent's version
  if (!parent || node.version !== parent.version) {
    badges.push(node.version);
  }

  const badgeStr = badges.map((b) => `[${b}]`).join("");
  const suffix = node.name ? ` ${node.name}` : "";

  return `${key} ${badgeStr}${suffix}`;
}
