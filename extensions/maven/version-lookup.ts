export {
  buildMetadataUrl,
  fetchMetadata,
  formatVersionLookupError,
  isPrerelease,
  parseMetadata,
  selectVersion,
  VersionLookupError,
} from "./vendor/maven-version-lookup.ts";
export type {
  ParsedMetadata,
  VersionLookupFailureCause,
  VersionLookupFailureDetails,
  VersionSelection,
} from "./vendor/maven-version-lookup.ts";
