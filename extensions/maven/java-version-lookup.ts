export const ADOPTIUM_AVAILABLE_RELEASES_URL = "https://api.adoptium.net/v3/info/available_releases";
const ADOPTIUM_USER_AGENT = "Mozilla/5.0";

export interface AvailableJavaVersions {
  availableLtsReleases: number[];
  availableReleases: number[];
  mostRecentFeatureRelease: number;
  mostRecentFeatureVersion: number;
  mostRecentLts: number;
  tipVersion: number;
}

export interface JavaReleaseMetadata {
  releaseDate: string;
  ageDays: number;
}

export async function fetchAvailableJavaVersions(signal?: AbortSignal): Promise<AvailableJavaVersions> {
  const response = await fetch(ADOPTIUM_AVAILABLE_RELEASES_URL, {
    signal,
    headers: { "user-agent": ADOPTIUM_USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`Adoptium returned ${response.status} for ${ADOPTIUM_AVAILABLE_RELEASES_URL}`);
  }
  return normalizeAvailableJavaVersions(await response.json());
}

export async function fetchJavaReleaseMetadata(featureVersion: number, signal?: AbortSignal): Promise<JavaReleaseMetadata> {
  const url = featureReleaseGaUrl(featureVersion);
  const response = await fetch(url, {
    signal,
    headers: { "user-agent": ADOPTIUM_USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`Adoptium returned ${response.status} for ${url}`);
  }
  return normalizeJavaReleaseMetadata(await response.json(), featureVersion);
}

export function normalizeAvailableJavaVersions(raw: unknown): AvailableJavaVersions {
  if (!raw || typeof raw !== "object") {
    throw new Error("Adoptium available releases response must be a JSON object");
  }

  const record = raw as Record<string, unknown>;
  return {
    availableLtsReleases: numberArray(record.available_lts_releases, "available_lts_releases"),
    availableReleases: numberArray(record.available_releases, "available_releases"),
    mostRecentFeatureRelease: integer(record.most_recent_feature_release, "most_recent_feature_release"),
    mostRecentFeatureVersion: integer(record.most_recent_feature_version, "most_recent_feature_version"),
    mostRecentLts: integer(record.most_recent_lts, "most_recent_lts"),
    tipVersion: integer(record.tip_version, "tip_version"),
  };
}

function numberArray(value: unknown, name: string): number[] {
  if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item))) {
    throw new Error(`Adoptium field '${name}' must be an array of integers`);
  }
  return [...value] as number[];
}

function integer(value: unknown, name: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`Adoptium field '${name}' must be an integer`);
  }
  return value as number;
}

function featureReleaseGaUrl(featureVersion: number): string {
  return `https://api.adoptium.net/v3/assets/feature_releases/${featureVersion}/ga?image_type=jdk&jvm_impl=hotspot&page_size=1&sort_order=ASC`;
}

function normalizeJavaReleaseMetadata(raw: unknown, featureVersion: number): JavaReleaseMetadata {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`Adoptium GA assets response for Java ${featureVersion} must be a non-empty JSON array`);
  }
  const first = raw[0];
  if (!first || typeof first !== "object") {
    throw new Error(`Adoptium GA assets response for Java ${featureVersion} must contain objects`);
  }
  const timestamp = (first as Record<string, unknown>).timestamp;
  if (typeof timestamp !== "string") {
    throw new Error(`Adoptium GA assets response for Java ${featureVersion} must contain a string timestamp`);
  }

  const releaseTime = Date.parse(timestamp);
  if (Number.isNaN(releaseTime)) {
    throw new Error(`Adoptium GA assets response for Java ${featureVersion} contains an invalid timestamp`);
  }

  return {
    releaseDate: timestamp,
    ageDays: Math.max(0, Math.floor((Date.now() - releaseTime) / 86_400_000)),
  };
}
