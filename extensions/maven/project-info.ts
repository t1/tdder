import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export interface PomInfo {
  groupId: string;
  artifactId: string;
  version: string;
  name: string;
  packaging: string;
  modules: string[];
}

export interface ProjectNode {
  groupId: string;
  artifactId: string;
  version: string;
  name: string;
  packaging: string;
  pomPath: string;
  relativePath: string;
  module: string | undefined;
  modules?: Record<string, ProjectNode>;
}

// ---------------------------------------------------------------------------
// Root discovery
// ---------------------------------------------------------------------------

export function findProjectRoot(dir: string): string | null {
  let current = resolve(dir);
  let lastPomDir: string | null = null;

  while (true) {
    if (existsSync(join(current, "pom.xml"))) {
      lastPomDir = current;
    }
    const parent = dirname(current);
    if (parent === current) break; // filesystem root
    current = parent;
  }

  return lastPomDir;
}

// ---------------------------------------------------------------------------
// Runner detection
// ---------------------------------------------------------------------------

export function detectRunner(projectRoot: string): string {
  return existsSync(join(projectRoot, "mvnw")) ? "./mvnw" : "mvn";
}

// ---------------------------------------------------------------------------
// POM parsing (regex-based, no XML library dependency)
// ---------------------------------------------------------------------------

function extractTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([^<]+)<\\/${tag}>`));
  return match ? match[1].trim() : "";
}

/**
 * Returns the slice of XML before the first block-level child element
 * (dependencies, build, modules, etc.) so coordinate extraction never
 * picks up <groupId> or <version> from inside <dependency> or <plugin> blocks.
 */
function projectCoordinateSection(xml: string): string {
  const blockStart = xml.search(/<(dependencies|dependencyManagement|build|profiles|modules|reporting|distributionManagement|repositories)[\s>]/);
  return blockStart === -1 ? xml : xml.slice(0, blockStart);
}

function extractModules(xml: string): string[] {
  const modulesBlock = xml.match(/<modules>([\s\S]*?)<\/modules>/);
  if (!modulesBlock) return [];
  return [...modulesBlock[1].matchAll(/<module>([^<]+)<\/module>/g)].map(
    (m) => m[1].trim()
  );
}

export function parsePom(pomPath: string): PomInfo {
  const raw = readFileSync(pomPath, "utf8");

  // Extract parent coordinates before stripping the <parent> block (used as fallbacks)
  const parentBlock = raw.match(/<parent>([\s\S]*?)<\/parent>/);
  const parentGroupId = parentBlock ? extractTag(parentBlock[1], "groupId") : "";
  const parentVersion = parentBlock ? extractTag(parentBlock[1], "version") : "";

  // Strip <parent>…</parent> so remaining extractions ignore inherited coordinates
  const xml = raw.replace(/<parent>[\s\S]*?<\/parent>/g, "");

  const coords = projectCoordinateSection(xml);
  const groupId = extractTag(coords, "groupId") || parentGroupId;
  const artifactId = extractTag(coords, "artifactId");
  const version = extractTag(coords, "version") || parentVersion;
  const name = extractTag(coords, "name");
  const packaging = extractTag(xml, "packaging") || "jar";
  const modules = extractModules(xml);

  return { groupId, artifactId, version, name, packaging, modules };
}

// ---------------------------------------------------------------------------
// Project tree
// ---------------------------------------------------------------------------

export function buildProjectTree(projectRoot: string): ProjectNode {
  return buildNode(projectRoot, projectRoot, ".");
}

function buildNode(
  projectRoot: string,
  nodeDir: string,
  relPath: string
): ProjectNode {
  const pomPath = join(nodeDir, "pom.xml");
  const pom = parsePom(pomPath);

  if (pom.modules.length > 0 && pom.packaging !== "pom") {
    throw new Error(
      `${pomPath}: declares <modules> but packaging is '${pom.packaging}' (expected 'pom')`
    );
  }

  // module is the path-based reactor selector used with `-pl`.
  // Only leaf projects (non-aggregators, not the root) get one.
  const isLeaf = pom.modules.length === 0;
  const isRoot = relPath === ".";
  const module = isLeaf && !isRoot ? relPath : undefined;

  const modules: Record<string, ProjectNode> = Object.fromEntries(
    pom.modules.map((mod) => {
      const childDir = join(nodeDir, mod);
      const childRel = relPath === "." ? mod : `${relPath}/${mod}`;
      return [mod, buildNode(projectRoot, childDir, childRel)];
    })
  );

  return {
    groupId: pom.groupId,
    artifactId: pom.artifactId,
    version: pom.version,
    name: pom.name,
    packaging: pom.packaging,
    pomPath,
    relativePath: relPath,
    module,
    ...(Object.keys(modules).length > 0 ? { modules } : {}),
  };
}

// ---------------------------------------------------------------------------
// Flatten project tree
// ---------------------------------------------------------------------------

export type FlatProjectNode = Omit<ProjectNode, "modules" | "relativePath">;

export function flattenNode(node: ProjectNode): FlatProjectNode {
  const { modules: _, relativePath: __, ...flat } = node;
  return flat;
}

export function flattenProjectTree(root: ProjectNode): FlatProjectNode[] {
  const result: FlatProjectNode[] = [];
  function visit(node: ProjectNode): void {
    const { modules: _, relativePath: __, ...flat } = node;
    result.push(flat);
    for (const child of Object.values(node.modules ?? {})) {
      visit(child);
    }
  }
  visit(root);
  return result;
}

// ---------------------------------------------------------------------------
// Current project resolution
// ---------------------------------------------------------------------------

export function resolveCurrentProject(
  tree: ProjectNode,
  projectRoot: string,
  cwd: string
): ProjectNode | null {
  const rel = relative(projectRoot, cwd);
  return findByRelativePath(tree, rel === "" ? "." : rel);
}

function findByRelativePath(
  node: ProjectNode,
  targetRel: string
): ProjectNode | null {
  if (node.relativePath === targetRel) return node;
  for (const child of Object.values(node.modules ?? {})) {
    const found = findByRelativePath(child, targetRel);
    if (found) return found;
  }
  return null;
}
