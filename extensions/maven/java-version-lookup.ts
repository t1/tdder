export const ADOPTIUM_AVAILABLE_RELEASES_URL = "https://api.adoptium.net/v3/info/available_releases";

export interface AvailableJavaVersions {
  availableLtsReleases: number[];
  availableReleases: number[];
  mostRecentFeatureRelease: number;
  mostRecentFeatureVersion: number;
  mostRecentLts: number;
  tipVersion: number;
}

export async function fetchAvailableJavaVersions(signal?: AbortSignal): Promise<AvailableJavaVersions> {
  const response = await fetch(ADOPTIUM_AVAILABLE_RELEASES_URL, { signal });
  if (!response.ok) {
    throw new Error(`Adoptium returned ${response.status} for ${ADOPTIUM_AVAILABLE_RELEASES_URL}`);
  }
  return normalizeAvailableJavaVersions(await response.json());
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
