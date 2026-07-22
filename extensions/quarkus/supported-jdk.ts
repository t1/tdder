import {existsSync, readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {parse} from "yaml";

const QUARKUS_CI_WORKFLOW_PATH = ".github/workflows/ci-actions-incremental.yml";

export interface DetectedQuarkusVersion {
  quarkusVersion: string;
  detectedFrom: string;
}

export interface LatestSupportedJdkInfo {
  quarkusVersion: string;
  quarkusSeries: string;
  workflowUrl: string;
  supportedJdkVersions: number[];
  latestSupportedJdk: number;
}

export function extractQuarkusSeries(quarkusVersion: string): string {
  const match = quarkusVersion.trim().match(/^(\d+)\.(\d+)/);
  if (!match) throw new Error(`Can't extract Quarkus major.minor series from version '${quarkusVersion}'`);
  return `${match[1]}.${match[2]}`;
}

export function buildQuarkusCiWorkflowUrl(quarkusSeries: string): string {
  return `https://raw.githubusercontent.com/quarkusio/quarkus/refs/heads/${quarkusSeries}/${QUARKUS_CI_WORKFLOW_PATH}`;
}

function extractPomProperties(pomXml: string): Map<string, string> {
  const properties = new Map<string, string>();
  for (const block of pomXml.matchAll(/<properties>([\s\S]*?)<\/properties>/g)) {
    for (const entry of block[1].matchAll(/<([A-Za-z0-9_.-]+)>([\s\S]*?)<\/\1>/g)) {
      properties.set(entry[1], entry[2].trim());
    }
  }
  return properties;
}

function resolvePomValue(value: string, properties: Map<string, string>, depth = 0): string {
  const trimmed = value.trim();
  const propertyRef = trimmed.match(/^\$\{([^}]+)}$/);
  if (!propertyRef) return trimmed;
  const resolved = properties.get(propertyRef[1]);
  if (!resolved || resolved === trimmed) return trimmed;
  if (depth >= 10) throw new Error(`Too many nested pom property indirections while resolving '${trimmed}'`);
  return resolvePomValue(resolved, properties, depth + 1);
}

function firstResolvedMatch(matches: Iterable<RegExpMatchArray>, properties: Map<string, string>): string | null {
  for (const match of matches) {
    const resolved = resolvePomValue(match[1], properties);
    if (resolved.length > 0) return resolved;
  }
  return null;
}

export function detectQuarkusVersionFromPom(pomXml: string): string | null {
  const properties = extractPomProperties(pomXml);

  for (const propertyName of ["quarkus.platform.version", "quarkus-plugin.version", "quarkus.version"]) {
    const value = properties.get(propertyName);
    if (value?.trim()) return resolvePomValue(value, properties);
  }

  const bomVersion = firstResolvedMatch(
    pomXml.matchAll(/<dependency>[\s\S]*?<groupId>io\.quarkus\.platform<\/groupId>[\s\S]*?<artifactId>quarkus-bom<\/artifactId>[\s\S]*?<version>([\s\S]*?)<\/version>[\s\S]*?<\/dependency>/g),
    properties,
  );
  if (bomVersion) return bomVersion;

  const pluginVersion = firstResolvedMatch(
    pomXml.matchAll(/<plugin>[\s\S]*?<groupId>io\.quarkus<\/groupId>[\s\S]*?<artifactId>quarkus-maven-plugin<\/artifactId>[\s\S]*?<version>([\s\S]*?)<\/version>[\s\S]*?<\/plugin>/g),
    properties,
  );
  if (pluginVersion) return pluginVersion;

  return null;
}

export function detectQuarkusVersionFromGradle(buildFile: string): string | null {
  for (const pattern of [
    /id\(["']io\.quarkus["']\)\s+version\s+["']([^"']+)["']/, 
    /id\s+["']io\.quarkus["']\s+version\s+["']([^"']+)["']/, 
    /(?:^|\n)\s*(?:val\s+)?quarkusPlatformVersion\s*=\s*["']([^"']+)["']/,
    /(?:^|\n)\s*(?:val\s+)?quarkusPluginVersion\s*=\s*["']([^"']+)["']/,
  ]) {
    const match = buildFile.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function walkUpDirectories(startDir: string): string[] {
  const dirs: string[] = [];
  let current = resolve(startDir);
  while (true) {
    dirs.push(current);
    const parent = dirname(current);
    if (parent === current) return dirs;
    current = parent;
  }
}

export function detectQuarkusVersionFromProject(startDir: string): DetectedQuarkusVersion | null {
  for (const dir of walkUpDirectories(startDir)) {
    const pomPath = join(dir, "pom.xml");
    if (existsSync(pomPath)) {
      const pomVersion = detectQuarkusVersionFromPom(readFileSync(pomPath, "utf8"));
      if (pomVersion) return {quarkusVersion: pomVersion, detectedFrom: pomPath};
    }

    for (const buildFile of ["build.gradle.kts", "build.gradle"]) {
      const buildPath = join(dir, buildFile);
      if (!existsSync(buildPath)) continue;
      const gradleVersion = detectQuarkusVersionFromGradle(readFileSync(buildPath, "utf8"));
      if (gradleVersion) return {quarkusVersion: gradleVersion, detectedFrom: buildPath};
    }
  }

  return null;
}

function parseJavaVersion(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
}

export function parseMavenTestsJavaVersions(workflowYaml: string): number[] {
  const workflow = parse(workflowYaml) as {
    jobs?: {
      [jobName: string]: {
        strategy?: {
          matrix?: {
            java?: Array<Record<string, unknown>>;
          };
        };
      };
    };
  };

  const javaMatrix = workflow.jobs?.["maven-tests"]?.strategy?.matrix?.java;
  if (!Array.isArray(javaMatrix)) return [];

  return Array.from(new Set(
    javaMatrix
      .map((entry) => parseJavaVersion(entry?.["java-version"]))
      .filter((version): version is number => version !== null),
  )).sort((left, right) => left - right);
}

export async function fetchLatestSupportedJdkForQuarkusVersion(
  quarkusVersion: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<LatestSupportedJdkInfo> {
  const quarkusSeries = extractQuarkusSeries(quarkusVersion);
  const workflowUrl = buildQuarkusCiWorkflowUrl(quarkusSeries);

  let response: Response;
  try {
    response = await fetchImpl(workflowUrl, {signal});
  } catch {
    throw new Error(`Failed to fetch ${workflowUrl}`);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch ${workflowUrl}: HTTP ${response.status}`);
  }

  const workflowYaml = await response.text();
  const supportedJdkVersions = parseMavenTestsJavaVersions(workflowYaml);
  if (supportedJdkVersions.length === 0) {
    throw new Error(`Couldn't find jobs.maven-tests.strategy.matrix.java.*.java-version in ${workflowUrl}`);
  }

  return {
    quarkusVersion,
    quarkusSeries,
    workflowUrl,
    supportedJdkVersions,
    latestSupportedJdk: supportedJdkVersions[supportedJdkVersions.length - 1]!,
  };
}
