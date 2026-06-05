/**
 * Drift detection: runs Maven on each fixture project and checks that the
 * produced surefire XML reports match the committed snapshots after normalisation.
 *
 * If this test fails after a Maven / JUnit / Cucumber upgrade, re-generate the
 * snapshots by running Maven in each project and re-running the normalisation
 * script (see the comment at the bottom of this file), then commit the result.
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const projectsDir = join(import.meta.dirname, "fixtures/projects");

// ---------------------------------------------------------------------------
// Normalisation — strips parts that legitimately vary between runs
// ---------------------------------------------------------------------------

function normalise(xml: string): string {
  return xml
    .replace(/<properties>[\s\S]*?<\/properties>\n?/g, "")
    .replace(/<system-out>[\s\S]*?<\/system-out>\n?/g, "")
    .replace(/\btime="[^"]*"/g, 'time="0"')
    .replace(/\((\w+\.(?:java|kt)):\d+\)/g, "($1:0)")
    .replace(/lambda\$\w+\$(\d+)/g, "lambda\$\$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runMaven(projectDir: string): void {
  const result = spawnSync("mvn", ["test", "-q", "--no-transfer-progress"], {
    cwd: projectDir,
    env: { ...process.env, MAVEN_OPTS: `-Djava.io.tmpdir=${join(projectDir, "target")}` },
    encoding: "utf8",
  });
  // Maven exits non-zero on test failures — that's expected and fine here.
  // Only hard errors (e.g. compilation failure, missing mvn) should abort the test.
  if (result.status === null) {
    throw new Error(`Maven process failed to start in ${projectDir}: ${result.error}`);
  }
  const isBuildError = result.status !== 0 &&
    (result.stderr?.includes("COMPILATION ERROR") || result.stderr?.includes("Could not resolve"));
  if (isBuildError) {
    throw new Error(`Maven build error in ${projectDir}:\n${result.stderr}`);
  }
}

function snapshotFiles(projectDir: string): string[] {
  const dir = join(projectDir, "expected-reports");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.startsWith("TEST-") && f.endsWith(".xml")).sort();
}

function assertMatchesSnapshot(projectDir: string, reportFile: string): void {
  const actual = join(projectDir, "target/surefire-reports", reportFile);
  const expected = join(projectDir, "expected-reports", reportFile);

  assert.ok(existsSync(actual), `Maven did not produce expected report: ${actual}`);

  const actualNorm = normalise(readFileSync(actual, "utf8"));
  const expectedNorm = normalise(readFileSync(expected, "utf8"));

  assert.equal(
    actualNorm,
    expectedNorm,
    `Surefire report drifted from snapshot.\n` +
    `Report:   ${actual}\n` +
    `Snapshot: ${expected}\n` +
    `Re-generate by running mvn test in the fixture project and re-running the normalisation script.`
  );
}

// ---------------------------------------------------------------------------
// One describe block per fixture project
// ---------------------------------------------------------------------------

describe.each([
  { project: "junit-java",   label: "JUnit Java (plain, @TestFactory, @Nested)" },
  { project: "junit-kotlin", label: "JUnit Kotlin (spaces in names, root package)" },
  { project: "cucumber",     label: "Cucumber (feature/scenario structure)" },
])("surefire report format — $label", ({ project }) => {
  const projectDir = join(projectsDir, project);
  const files = snapshotFiles(projectDir);

  it("produces surefire reports when Maven runs", () => {
    runMaven(projectDir);
    for (const file of files) {
      assert.ok(
        existsSync(join(projectDir, "target/surefire-reports", file)),
        `Expected report not produced: ${file}`
      );
    }
  });

  for (const file of files) {
    it(`${file} matches committed snapshot`, () => {
      assertMatchesSnapshot(projectDir, file);
    });
  }
});


/*
 * To re-generate snapshots after an intentional format change:
 *
 *   cd extensions/maven/test/fixtures/projects/junit-java  && mvn test -q; cd -
 *   cd extensions/maven/test/fixtures/projects/junit-kotlin && mvn test -q; cd -
 *   cd extensions/maven/test/fixtures/projects/cucumber     && mvn test -q; cd -
 *   for p in junit-java junit-kotlin cucumber; do
 *     cp extensions/maven/test/fixtures/projects/$p/target/surefire-reports/TEST-*.xml \
 *        extensions/maven/test/fixtures/projects/$p/expected-reports/
 *   done
 */
