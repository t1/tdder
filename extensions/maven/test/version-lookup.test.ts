import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildMetadataUrl,
  parseMetadata,
  selectVersion,
} from "../version-lookup.ts";
import {
  ADOPTIUM_AVAILABLE_RELEASES_URL,
  normalizeAvailableJavaVersions,
} from "../java-version-lookup.ts";

const fixturesDir = join(import.meta.dirname, "fixtures/metadata");

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

describe("buildMetadataUrl", () => {
  it("builds the correct URL from groupId and artifactId", () => {
    const url = buildMetadataUrl("org.assertj", "assertj-core");
    assert.equal(
      url,
      "https://repo1.maven.org/maven2/org/assertj/assertj-core/maven-metadata.xml"
    );
  });
});

describe("parseMetadata", () => {
  it("returns the release element as latestVersion when present", () => {
    const xml = loadFixture("assertj-core.xml");
    const result = parseMetadata(xml);
    assert.equal(result.latestVersion, "3.27.3");
  });

  it("falls back to last version element when release is absent", () => {
    const xml = loadFixture("no-release-element.xml");
    const result = parseMetadata(xml);
    assert.equal(result.latestVersion, "1.2.0");
  });

  it("returns an RC as latestVersion when release points to an RC", () => {
    const xml = loadFixture("latest-is-rc.xml");
    const result = parseMetadata(xml);
    assert.equal(result.latestVersion, "2.0.0.RC2");
  });

  it("falls back to last version when release is absent and last version is a SNAPSHOT", () => {
    const xml = loadFixture("latest-is-snapshot.xml");
    const result = parseMetadata(xml);
    assert.equal(result.latestVersion, "1.2.0-SNAPSHOT");
  });

  it("includes all versions from the versions list", () => {
    const xml = loadFixture("latest-is-rc.xml");
    const result = parseMetadata(xml);
    assert.deepEqual(result.versions, ["1.9.0", "2.0.0.M1", "2.0.0.RC1", "2.0.0.RC2"]);
  });
});

describe("selectVersion", () => {
  it("returns latestVersion as selectedVersion when it is stable", () => {
    const result = selectVersion("3.27.3", ["3.26.0", "3.27.0", "3.27.3"], false);
    assert.equal(result.selectedVersion, "3.27.3");
    assert.equal(result.prereleaseFiltered, false);
  });

  it("filters out the RC latestVersion and selects the last stable version", () => {
    const versions = ["1.9.0", "2.0.0.M1", "2.0.0.RC1", "2.0.0.RC2"];
    const result = selectVersion("2.0.0.RC2", versions, false);
    assert.equal(result.selectedVersion, "1.9.0");
    assert.equal(result.prereleaseFiltered, true);
  });

  it("returns the RC as selectedVersion when includePrereleases is true", () => {
    const versions = ["1.9.0", "2.0.0.M1", "2.0.0.RC1", "2.0.0.RC2"];
    const result = selectVersion("2.0.0.RC2", versions, true);
    assert.equal(result.selectedVersion, "2.0.0.RC2");
    assert.equal(result.prereleaseFiltered, false);
  });

  it("filters out SNAPSHOT and selects last stable version", () => {
    const versions = ["1.0.0", "1.1.0", "1.2.0-SNAPSHOT"];
    const result = selectVersion("1.2.0-SNAPSHOT", versions, false);
    assert.equal(result.selectedVersion, "1.1.0");
    assert.equal(result.prereleaseFiltered, true);
  });
});

describe("normalizeAvailableJavaVersions", () => {
  it("returns the canonical Adoptium URL constant", () => {
    assert.equal(ADOPTIUM_AVAILABLE_RELEASES_URL, "https://api.adoptium.net/v3/info/available_releases");
  });

  it("maps Adoptium available releases to the internal shape", () => {
    const result = normalizeAvailableJavaVersions({
      available_lts_releases: [8, 11, 17, 21],
      available_releases: [8, 11, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
      most_recent_feature_release: 25,
      most_recent_feature_version: 26,
      most_recent_lts: 21,
      tip_version: 26,
    });

    assert.deepEqual(result.availableLtsReleases, [8, 11, 17, 21]);
    assert.deepEqual(result.availableReleases, [8, 11, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
    assert.equal(result.mostRecentFeatureRelease, 25);
    assert.equal(result.mostRecentFeatureVersion, 26);
    assert.equal(result.mostRecentLts, 21);
    assert.equal(result.tipVersion, 26);
  });

  it("fails when a required field is missing or malformed", () => {
    assert.throws(
      () => normalizeAvailableJavaVersions({
        available_lts_releases: [17],
        available_releases: [17, 21],
        most_recent_feature_version: 22,
        most_recent_lts: 21,
        tip_version: 22,
      }),
      /most_recent_feature_release/,
    );
  });
});
