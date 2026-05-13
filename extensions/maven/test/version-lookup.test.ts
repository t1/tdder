import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildMetadataUrl,
  parseMetadata,
  selectVersion,
} from "../version-lookup.ts";

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
