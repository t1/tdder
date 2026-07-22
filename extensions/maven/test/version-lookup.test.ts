import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildMetadataUrl,
  fetchMetadata,
  isPrerelease,
  parseMetadata,
  selectVersion,
  VersionLookupError,
} from "../version-lookup.ts";
import {
  ADOPTIUM_AVAILABLE_RELEASES_URL,
  fetchJavaReleaseMetadata,
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

function xmlResponse(status: number, body = ""): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/xml" },
  });
}

describe("fetchMetadata", () => {
  it("reports coordinates_not_found only after probe success and retry 404", async () => {
    const xml = loadFixture("assertj-core.xml");
    const fetchMock: typeof fetch = async (url: string | URL | Request) => {
      const urlString = String(url);
      if (urlString.includes("com/example/missing-artifact")) return xmlResponse(404);
      if (urlString.includes("org/assertj/assertj-core")) return xmlResponse(200, xml);
      throw new Error(`unexpected url: ${urlString}`);
    };

    await assert.rejects(
      () => fetchMetadata("com.example", "missing-artifact", undefined, fetchMock),
      (error: unknown) => {
        assert.ok(error instanceof VersionLookupError);
        assert.equal(error.details.cause, "coordinates_not_found");
        assert.equal(error.details.initialStatus, 404);
        assert.equal(error.details.probeStatus, 200);
        assert.equal(error.details.retryStatus, 404);
        return true;
      },
    );
  });

  it("reports network_problem when the known-good probe also returns 404", async () => {
    const fetchMock: typeof fetch = async () => xmlResponse(404);

    await assert.rejects(
      () => fetchMetadata("com.example", "missing-artifact", undefined, fetchMock),
      (error: unknown) => {
        assert.ok(error instanceof VersionLookupError);
        assert.equal(error.details.cause, "network_problem");
        assert.equal(error.details.initialStatus, 404);
        assert.equal(error.details.probeStatus, 404);
        return true;
      },
    );
  });

  it("reports upstream_http_error for non-404 HTTP failures", async () => {
    const fetchMock: typeof fetch = async () => xmlResponse(429);

    await assert.rejects(
      () => fetchMetadata("org.assertj", "assertj-core", undefined, fetchMock),
      (error: unknown) => {
        assert.ok(error instanceof VersionLookupError);
        assert.equal(error.details.cause, "upstream_http_error");
        assert.equal(error.details.status, 429);
        return true;
      },
    );
  });
});

describe("isPrerelease", () => {
  const assertPre = (v: string) =>
    assert.equal(isPrerelease(v), true, `expected prerelease: ${v}`);
  const assertStable = (v: string) =>
    assert.equal(isPrerelease(v), false, `expected stable: ${v}`);

  it("matches alpha, beta, milestone, rc, and snapshot qualifiers", () => {
    for (const v of [
      "1.0.0-alpha", "1.0.0-alpha1", "1.0.0-alpha-1",
      "1.0.0-beta", "1.0.0-beta2",
      "1.0.0-milestone", "1.0.0.milestone", "1.0.0-milestone1",
      "1.0.0-rc", "1.0.0-rc1",
      "1.0.0-snapshot", "1.0.0-SNAPSHOT",
      "1.0alpha1", "1.0.0alpha1",
    ]) assertPre(v);
  });

  it("treats cr as an alias for rc", () => {
    for (const v of ["1.0.0.CR1", "1.0.0-CR1", "1.0.0.cr", "3.38.0.CR1"]) assertPre(v);
  });

  it("matches single-letter a/b/m only when followed by a digit", () => {
    for (const v of ["1.0.0-a1", "1.0.0-b1", "1.0.0.A1", "1.0.0.B2", "1.0.0.M1", "1.0.0.m1"]) assertPre(v);
  });

  it("does not treat bare single-letter qualifiers as prerelease (Maven ranks them above release)", () => {
    for (const v of ["1.0.0.m", "1.0.0-M", "1.0.0-a", "1.0.0-b", "1.0.0.a", "1.0.0-b"]) assertStable(v);
  });

  it("does not filter release-equivalent qualifiers (ga, final, release)", () => {
    for (const v of ["1.0.0", "1.0.0.Final", "1.0.0-ga", "1.0.0-release", "1.0.0.GA", "1.0.0.RELEASE"]) assertStable(v);
  });

  it("does not filter post-release service packs (sp)", () => {
    for (const v of ["1.0.0-sp1", "1.0.0.SP1", "1.0.0-sp", "1.0.0-SP2"]) assertStable(v);
  });

  it("does not filter unknown qualifiers (Maven ranks them above release)", () => {
    for (const v of [
      "1.0.0-dev", "1.0.0-dev.3", "1.0.0-ea", "21-ea", "17.0.0-ea",
      "1.0.0-preview", "1.0.0-preview1", "1.0.0-pre", "1.0.0-pre1", "1.0.0-nightly",
    ]) assertStable(v);
  });

  it("does not match qualifiers as substrings of longer tokens", () => {
    for (const v of ["1.0.0.alphabetical", "1.0.0.amd64", "1.0.0.Predicate", "1.0.0.Device", "1.0.0.jre8", "1.0.0.Linux"]) assertStable(v);
  });

  it("is case-insensitive", () => {
    for (const v of ["1.0.0-Alpha", "1.0.0.ALPHA", "1.0.0-Beta", "1.0.0-Milestone", "1.0.0.RC1"]) assertPre(v);
  });

  it("treats the reported 3.38.0.CR1 as prerelease and 3.37.3 as stable", () => {
    assertPre("3.38.0.CR1");
    assertStable("3.37.3");
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

  it("filters out the CR latestVersion and selects the last stable version", () => {
    const versions = ["3.37.3", "3.38.0.CR1"];
    const result = selectVersion("3.38.0.CR1", versions, false);
    assert.equal(result.selectedVersion, "3.37.3");
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

describe("fetchJavaReleaseMetadata", () => {
  it("derives release date and non-negative age from the earliest GA asset timestamp", async () => {
    const fetchMock: typeof fetch = async () => new Response(JSON.stringify([
      { timestamp: "2025-09-17T11:42:50Z" },
    ]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const realFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      const result = await fetchJavaReleaseMetadata(25);
      assert.equal(result.releaseDate, "2025-09-17T11:42:50Z");
      assert.ok(Number.isInteger(result.ageDays));
      assert.ok(result.ageDays >= 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("fails when the GA assets response is empty", async () => {
    const fetchMock: typeof fetch = async () => new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const realFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      await assert.rejects(() => fetchJavaReleaseMetadata(25), /non-empty JSON array/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
