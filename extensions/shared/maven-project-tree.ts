import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export interface PomInfo {
  groupId: string;
  artifactId: string;
  version: string;
  name: string;
  description: string;
  packaging: string;
  modules: string[];
}

export interface ProjectNode {
  groupId: string;
  artifactId: string;
  version: string;
  name: string;
  description: string;
  packaging: string;
  pomPath: string;
  relativePath: string;
  modules?: Record<string, ProjectNode>;
}

export function findProjectRoot(dir: string): string | null {
  let current = resolve(dir);
  let lastPomDir: string | null = null;

  while (true) {
    if (existsSync(join(current, "pom.xml"))) {
      lastPomDir = current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return lastPomDir;
}

function extractTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([^<]+)<\\/${tag}>`));
  return match ? match[1].trim() : "";
}

function projectCoordinateSection(xml: string): string {
  const blockStart = xml.search(/<(dependencies|dependencyManagement|build|profiles|modules|reporting|distributionManagement|repositories)[\s>]/);
  return blockStart === -1 ? xml : xml.slice(0, blockStart);
}

function extractModules(xml: string): string[] {
  const modulesBlock = xml.match(/<modules>([\s\S]*?)<\/modules>/);
  if (!modulesBlock) return [];
  return [...modulesBlock[1].matchAll(/<module>([^<]+)<\/module>/g)].map((m) => m[1].trim());
}

export function parsePom(pomPath: string): PomInfo {
  const raw = readFileSync(pomPath, "utf8");

  const parentBlock = raw.match(/<parent>([\s\S]*?)<\/parent>/);
  const parentGroupId = parentBlock ? extractTag(parentBlock[1], "groupId") : "";
  const parentVersion = parentBlock ? extractTag(parentBlock[1], "version") : "";

  const xml = raw.replace(/<parent>[\s\S]*?<\/parent>/g, "");

  const coords = projectCoordinateSection(xml);
  const groupId = extractTag(coords, "groupId") || parentGroupId;
  const artifactId = extractTag(coords, "artifactId");
  const version = extractTag(coords, "version") || parentVersion;
  const name = extractTag(coords, "name");
  const description = extractTag(coords, "description");
  const packaging = extractTag(xml, "packaging") || "jar";
  const modules = extractModules(xml);

  return { groupId, artifactId, version, name, description, packaging, modules };
}

export function buildProjectTree(projectRoot: string): ProjectNode {
  return buildNode(projectRoot, ".");
}

function buildNode(nodeDir: string, relPath: string): ProjectNode {
  const pomPath = join(nodeDir, "pom.xml");
  const pom = parsePom(pomPath);

  if (pom.modules.length > 0 && pom.packaging !== "pom") {
    throw new Error(`${pomPath}: declares <modules> but packaging is '${pom.packaging}' (expected 'pom')`);
  }

  const modules: Record<string, ProjectNode> = Object.fromEntries(
    pom.modules.map((mod) => {
      const childDir = join(nodeDir, mod);
      const childRel = relPath === "." ? mod : `${relPath}/${mod}`;
      return [mod, buildNode(childDir, childRel)];
    }),
  );

  return {
    groupId: pom.groupId,
    artifactId: pom.artifactId,
    version: pom.version,
    name: pom.name,
    description: pom.description,
    packaging: pom.packaging,
    pomPath,
    relativePath: relPath,
    ...(Object.keys(modules).length > 0 ? { modules } : {}),
  };
}

export function stripInternalFields(node: ProjectNode): Omit<ProjectNode, "relativePath" | "pomPath" | "modules"> & { modules?: Record<string, ReturnType<typeof stripInternalFields>> } {
  const { relativePath: _, pomPath: __, modules, description, name, ...rest } = node;
  const strippedModules = modules
    ? Object.fromEntries(Object.entries(modules).map(([k, v]) => [k, stripInternalFields(v)]))
    : undefined;
  return {
    ...rest,
    name,
    description,
    ...(strippedModules ? { modules: strippedModules } : {}),
  };
}

export function resolveCurrentProject(tree: ProjectNode, projectRoot: string, cwd: string): ProjectNode | null {
  const rel = relative(projectRoot, cwd);
  return findByRelativePath(tree, rel === "" ? "." : rel);
}

function findByRelativePath(node: ProjectNode, targetRel: string): ProjectNode | null {
  if (node.relativePath === targetRel) return node;
  for (const child of Object.values(node.modules ?? {})) {
    const found = findByRelativePath(child, targetRel);
    if (found) return found;
  }
  return null;
}
