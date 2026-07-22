const MAVEN_CENTRAL_BASE = "https://repo1.maven.org/maven2";
const KNOWN_GOOD_COORDINATES = { groupId: "org.assertj", artifactId: "assertj-core" };

export function buildMetadataUrl(groupId: string, artifactId: string): string {
  const groupPath = groupId.replaceAll(".", "/");
  return `${MAVEN_CENTRAL_BASE}/${groupPath}/${artifactId}/maven-metadata.xml`;
}

export interface ParsedMetadata {
  latestVersion: string;
  versions: string[];
}

export type VersionLookupFailureCause = "coordinates_not_found" | "network_problem" | "upstream_http_error";

export interface VersionLookupFailureDetails {
  cause: VersionLookupFailureCause;
  groupId: string;
  artifactId: string;
  metadataUrl: string;
  status?: number;
  initialStatus?: number;
  probeUrl?: string;
  probeStatus?: number;
  retryStatus?: number;
}

export class VersionLookupError extends Error {
  readonly details: VersionLookupFailureDetails;

  constructor(details: VersionLookupFailureDetails) {
    super(formatVersionLookupError(details));
    this.name = "VersionLookupError";
    this.details = details;
  }
}

export function formatVersionLookupError(details: VersionLookupFailureDetails): string {
  return `Version lookup failed: ${JSON.stringify(details)}`;
}

type FetchLike = typeof fetch;

async function fetchResponse(
  url: string,
  signal: AbortSignal | undefined,
  fetchImpl: FetchLike,
  onNetworkError: () => VersionLookupError,
): Promise<Response> {
  try {
    return await fetchImpl(url, { signal });
  } catch {
    throw onNetworkError();
  }
}

async function readMetadata(response: Response): Promise<ParsedMetadata> {
  const xml = await response.text();
  return parseMetadata(xml);
}

export async function fetchMetadata(
  groupId: string,
  artifactId: string,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<ParsedMetadata> {
  const metadataUrl = buildMetadataUrl(groupId, artifactId);
  const initialResponse = await fetchResponse(
    metadataUrl,
    signal,
    fetchImpl,
    () => new VersionLookupError({ cause: "network_problem", groupId, artifactId, metadataUrl }),
  );

  if (initialResponse.ok) return readMetadata(initialResponse);

  if (initialResponse.status !== 404) {
    throw new VersionLookupError({
      cause: "upstream_http_error",
      groupId,
      artifactId,
      metadataUrl,
      status: initialResponse.status,
    });
  }

  const probeUrl = buildMetadataUrl(KNOWN_GOOD_COORDINATES.groupId, KNOWN_GOOD_COORDINATES.artifactId);
  const probeResponse = await fetchResponse(
    probeUrl,
    signal,
    fetchImpl,
    () => new VersionLookupError({
      cause: "network_problem",
      groupId,
      artifactId,
      metadataUrl,
      initialStatus: 404,
      probeUrl,
    }),
  );

  if (!probeResponse.ok) {
    throw new VersionLookupError({
      cause: probeResponse.status === 404 ? "network_problem" : "upstream_http_error",
      groupId,
      artifactId,
      metadataUrl,
      status: probeResponse.status,
      initialStatus: 404,
      probeUrl,
      probeStatus: probeResponse.status,
    });
  }

  const retryResponse = await fetchResponse(
    metadataUrl,
    signal,
    fetchImpl,
    () => new VersionLookupError({
      cause: "network_problem",
      groupId,
      artifactId,
      metadataUrl,
      initialStatus: 404,
      probeUrl,
      probeStatus: probeResponse.status,
    }),
  );

  if (retryResponse.ok) return readMetadata(retryResponse);

  if (retryResponse.status === 404) {
    throw new VersionLookupError({
      cause: "coordinates_not_found",
      groupId,
      artifactId,
      metadataUrl,
      initialStatus: 404,
      probeUrl,
      probeStatus: probeResponse.status,
      retryStatus: 404,
    });
  }

  throw new VersionLookupError({
    cause: "upstream_http_error",
    groupId,
    artifactId,
    metadataUrl,
    status: retryResponse.status,
    initialStatus: 404,
    probeUrl,
    probeStatus: probeResponse.status,
    retryStatus: retryResponse.status,
  });
}

export function parseMetadata(xml: string): ParsedMetadata {
  const releaseMatch = xml.match(/<release>([^<]+)<\/release>/);
  const versionMatches = [...xml.matchAll(/<version>([^<]+)<\/version>/g)];
  const versions = versionMatches.map((m) => m[1]);

  const latestVersion = releaseMatch ? releaseMatch[1] : (versions.at(-1) ?? "");

  return { latestVersion, versions };
}

export interface VersionSelection {
  selectedVersion: string;
  prereleaseFiltered: boolean;
}

// Mirrors Maven's ComparableVersion qualifier semantics (case-insensitive):
// prerelease qualifiers are alpha/beta/milestone/rc/snapshot (ranked strictly below
// release). Single-letter a/b/m expand to alpha/beta/milestone ONLY when immediately
// followed by a digit (e.g. "1.0.0-a1"), matching Maven's StringItem(followedByDigit).
// Aliases cr->rc, ga/final/release->"" (release). Unknown qualifiers (dev, ea, preview,
// pre, nightly, ...) rank ABOVE release and are therefore NOT prereleases.
const PRERELEASE_QUALIFIERS = new Set(["alpha", "beta", "milestone", "rc", "snapshot"]);
const QUALIFIER_ALIASES: Record<string, string> = {
  cr: "rc",
  ga: "",
  final: "",
  release: "",
};
const SINGLE_LETTER_QUALIFIERS: Record<string, string> = {
  a: "alpha",
  b: "beta",
  m: "milestone",
};

function resolveQualifier(token: string, followedByDigit: boolean): string {
  if (token.length === 1 && followedByDigit) {
    return SINGLE_LETTER_QUALIFIERS[token] ?? token;
  }
  return QUALIFIER_ALIASES[token] ?? token;
}

export function isPrerelease(version: string): boolean {
  const lower = version.toLowerCase();
  for (const match of lower.matchAll(/[a-z]+/g)) {
    const token = match[0];
    const followedByDigit = /\d/.test(lower.charAt((match.index ?? 0) + token.length));
    if (PRERELEASE_QUALIFIERS.has(resolveQualifier(token, followedByDigit))) return true;
  }
  return false;
}

export function selectVersion(
  latestVersion: string,
  versions: string[],
  includePrereleases: boolean,
): VersionSelection {
  if (includePrereleases || !isPrerelease(latestVersion)) {
    return { selectedVersion: latestVersion, prereleaseFiltered: false };
  }

  const stableVersions = versions.filter((v) => !isPrerelease(v));
  const selectedVersion = stableVersions[stableVersions.length - 1] ?? latestVersion;
  return { selectedVersion, prereleaseFiltered: selectedVersion !== latestVersion };
}
