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
  const header: string[] = [
    "Maven project",
    `rootPath:    ${projectRoot}`,
    `runner:      ${runner}`,
    `currentPath: ${currentProject?.relativePath ?? "."}`,
    "projects:",
  ];

  const rows = collectRows(projectTree, 0, currentProject);
  const col1Width = Math.max(...rows.map((r) => r.col1.length));
  const col2Width = Math.max(...rows.map((r) => r.col2.length));

  const projectLines = rows.map((r) => formatRow(r, col1Width, col2Width));

  return [...header, ...projectLines].join("\n");
}

// ---------------------------------------------------------------------------
// Row data — collected in a first pass, before any padding is applied
// ---------------------------------------------------------------------------

export interface Row {
  col1: string;      // "<indent>- <key>"  (no trailing padding)
  col2: string;      // "groupId? · artifactId? · packaging · version?"
  col3: string;      // POM <name>, or ""
  isCurrent: boolean;
}

export function collectRows(
  node: ProjectNode,
  depth: number,
  current: ProjectNode | null,
  moduleKey?: string,
  parent?: ProjectNode,
): Row[] {
  const cols = nodeColumns(node, depth, moduleKey, parent);
  const isCurrent = current !== null && node.relativePath === current.relativePath;
  const rows: Row[] = [{ ...cols, isCurrent }];
  for (const [key, child] of Object.entries(node.modules ?? {})) {
    rows.push(...collectRows(child, depth + 1, current, key, node));
  }
  return rows;
}

function formatRow(row: Row, col1Width: number, col2Width: number): string {
  const parts = [row.col1.padEnd(col1Width)];
  if (row.col2) parts.push(row.col2.padEnd(col2Width));
  if (row.col3) {
    // col2 may be empty — pad col1 and skip straight to col3
    if (!row.col2) parts.push("".padEnd(col2Width));
    parts.push(row.col3);
  }
  return parts.join("  ").trimEnd();
}

// ---------------------------------------------------------------------------
// Column values for a single node — pure, easily testable
// ---------------------------------------------------------------------------

export interface NodeColumns {
  col1: string;   // "<indent>- <key>"
  col2: string;   // details joined with " · "
  col3: string;   // POM <name>, if any
}

export function nodeColumns(
  node: ProjectNode,
  depth: number,
  moduleKey: string | undefined,
  parent: ProjectNode | undefined,
): NodeColumns {
  const indent = "  ".repeat(depth);
  const key = moduleKey ?? node.artifactId;
  const col1 = `${indent}- ${key}`;

  const details: string[] = [];

  // groupId: show when no parent (root) or differs from parent's groupId
  if (!parent || node.groupId !== parent.groupId) {
    details.push(node.groupId);
  }

  // artifactId: show when it differs from the module key
  if (node.artifactId !== key) {
    details.push(node.artifactId);
  }

  // packaging: always shown
  details.push(node.packaging);

  // version: show only when it differs from parent's version
  if (!parent || node.version !== parent.version) {
    details.push(node.version);
  }

  const col2 = details.join(" · ");
  const col3 = node.name;

  return { col1, col2, col3 };
}
