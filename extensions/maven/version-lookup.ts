const MAVEN_CENTRAL_BASE = "https://repo1.maven.org/maven2";

export function buildMetadataUrl(groupId: string, artifactId: string): string {
  const groupPath = groupId.replaceAll(".", "/");
  return `${MAVEN_CENTRAL_BASE}/${groupPath}/${artifactId}/maven-metadata.xml`;
}

// ---------------------------------------------------------------------------

export interface ParsedMetadata {
  latestVersion: string;
  versions: string[];
}

export function parseMetadata(xml: string): ParsedMetadata {
  const releaseMatch = xml.match(/<release>([^<]+)<\/release>/);
  const versionMatches = [...xml.matchAll(/<version>([^<]+)<\/version>/g)];
  const versions = versionMatches.map((m) => m[1]);

  const latestVersion = releaseMatch ? releaseMatch[1] : (versions.at(-1) ?? "");

  return { latestVersion, versions };
}

// ---------------------------------------------------------------------------

export interface VersionSelection {
  selectedVersion: string;
  prereleaseFiltered: boolean;
}

const PRERELEASE_PATTERN = /[-.]?(SNAPSHOT|alpha|beta|RC\d*|M\d*|milestone)/i;

function isPrerelease(version: string): boolean {
  return PRERELEASE_PATTERN.test(version);
}

export function selectVersion(
  latestVersion: string,
  versions: string[],
  includePrereleases: boolean
): VersionSelection {
  if (includePrereleases || !isPrerelease(latestVersion)) {
    return { selectedVersion: latestVersion, prereleaseFiltered: false };
  }

  const stableVersions = versions.filter((v) => !isPrerelease(v));
  const selectedVersion = stableVersions[stableVersions.length - 1] ?? latestVersion;
  return { selectedVersion, prereleaseFiltered: selectedVersion !== latestVersion };
}
