import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {
  detectQuarkusVersionFromPom,
  extractQuarkusSeries,
  fetchLatestSupportedJdkForQuarkusVersion,
  parseMavenTestsJavaVersions,
} from "../supported-jdk.ts";

const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");

describe("supported JDK helper", () => {
  it("detects the Quarkus version from the bootstrap pom property", () => {
    const pom = `
      <project>
        <properties>
          <quarkus.platform.version>3.37.6</quarkus.platform.version>
        </properties>
      </project>
    `;

    assert.equal(detectQuarkusVersionFromPom(pom), "3.37.6");
  });

  it("resolves a quarkus-bom version through a pom property", () => {
    const pom = `
      <project>
        <properties>
          <my.quarkus.version>3.37.6</my.quarkus.version>
        </properties>
        <dependencyManagement>
          <dependencies>
            <dependency>
              <groupId>io.quarkus.platform</groupId>
              <artifactId>quarkus-bom</artifactId>
              <version>
                ${"${my.quarkus.version}"}
              </version>
            </dependency>
          </dependencies>
        </dependencyManagement>
      </project>
    `;

    assert.equal(detectQuarkusVersionFromPom(pom), "3.37.6");
  });

  it("extracts the major.minor Quarkus series", () => {
    assert.equal(extractQuarkusSeries("3.37.6"), "3.37");
    assert.equal(extractQuarkusSeries("3.37.0.CR1"), "3.37");
  });

  it("parses java versions only from jobs.maven-tests", () => {
    const workflow = `
name: CI
jobs:
  maven-tests:
    strategy:
      matrix:
        java:
          - { name: "17", java-version: 17 }
          - { name: "25", java-version: 25 }
  tcks-test:
    steps:
      - name: Set up JDK 21
`;

    assert.deepEqual(parseMavenTestsJavaVersions(workflow), [17, 25]);
  });

  it("fetches the latest supported JDK from the Quarkus branch workflow", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      return new Response(`
name: CI
jobs:
  maven-tests:
    strategy:
      matrix:
        java:
          - { name: "17", java-version: 17 }
          - { name: "25", java-version: 25 }
  tcks-test:
    steps:
      - name: Set up JDK 21
`, {status: 200});
    };

    const supported = await fetchLatestSupportedJdkForQuarkusVersion("3.37.6", undefined, fetchImpl);

    assert.equal(calls[0], "https://raw.githubusercontent.com/quarkusio/quarkus/refs/heads/3.37/.github/workflows/ci-actions-incremental.yml");
    assert.equal(supported.quarkusVersion, "3.37.6");
    assert.equal(supported.quarkusSeries, "3.37");
    assert.deepEqual(supported.supportedJdkVersions, [17, 25]);
    assert.equal(supported.latestSupportedJdk, 25);
  });
});

describe("quarkus_latest_supported_jdk tool", () => {
  it("registers a native quarkus_latest_supported_jdk tool", () => {
    assert.match(src, /name: "quarkus_latest_supported_jdk"/);
  });

  it("has tool guidelines for choosing a Quarkus JDK", () => {
    const idx = src.indexOf("quarkus_latest_supported_jdk:");
    assert.ok(idx >= 0, "TOOL_GUIDELINES must have a quarkus_latest_supported_jdk entry");
    const block = src.slice(idx, idx + 500);
    assert.match(block, /latest supported JDK/i);
    assert.match(block, /Quarkus version/i);
  });
});
