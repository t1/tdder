import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { parsePom } from "../project-info.ts";

import { parseClasspath, extractSkillsFromJar, loadJarSkills } from "../jar-skills.ts";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tmp: string;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), "jar-skills-test-"));
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeJar(name: string, skills: Record<string, string>): string {
  const src = join(tmp, `${name}-src`);
  const jar = join(tmp, `${name}.jar`);
  mkdirSync(src, { recursive: true });
  for (const [file, content] of Object.entries(skills)) {
    const dest = join(src, "META-INF", ".agent", "skills", file);
    mkdirSync(join(src, "META-INF", ".agent", "skills"), { recursive: true });
    writeFileSync(dest, content, "utf8");
  }
  spawnSync("jar", ["cf", jar, "-C", src, "."], { cwd: tmp });
  return jar;
}

// ---------------------------------------------------------------------------
// parseClasspath
// ---------------------------------------------------------------------------

describe("parseClasspath", () => {
  it("returns empty array for empty string", () => {
    assert.deepEqual(parseClasspath(""), []);
  });

  it("splits colon-separated JAR paths", () => {
    assert.deepEqual(parseClasspath("/a.jar:/b.jar"), ["/a.jar", "/b.jar"]);
  });
});

// ---------------------------------------------------------------------------
// extractSkillsFromJar
// ---------------------------------------------------------------------------

describe("extractSkillsFromJar", () => {
  it("returns empty map for a JAR with no skill files", async () => {
    const jar = makeJar("no-skills", {});
    const result = await extractSkillsFromJar(jar);
    assert.equal(result.size, 0);
  });

  it("returns skill name and content for a JAR with one skill", async () => {
    const jar = makeJar("one-skill", { "bulma-java.md": "# Bulma\nSome content." });
    const result = await extractSkillsFromJar(jar);
    assert.equal(result.size, 1);
    assert.equal(result.get("bulma-java.md"), "# Bulma\nSome content.");
  });

  it("returns all entries for a JAR with multiple skill files", async () => {
    const jar = makeJar("multi-skill", {
      "alpha.md": "Alpha skill",
      "beta.md": "Beta skill",
    });
    const result = await extractSkillsFromJar(jar);
    assert.equal(result.size, 2);
    assert.equal(result.get("alpha.md"), "Alpha skill");
    assert.equal(result.get("beta.md"), "Beta skill");
  });
});

// ---------------------------------------------------------------------------
// loadJarSkills
// ---------------------------------------------------------------------------

describe("loadJarSkills", () => {
  it("returns null when there is no pom.xml", async () => {
    const dir = join(tmp, "not-a-maven-project");
    mkdirSync(dir, { recursive: true });
    const result = await loadJarSkills(dir);
    assert.equal(result, null);
  });

  it("returns null when no JARs on the classpath contain skills", async () => {
    const result = await loadJarSkills(join(import.meta.dirname, "fixtures/projects/single-module"));
    assert.equal(result, null);
  });

  it("uses the Maven wrapper to resolve the classpath when mvnw exists", async () => {
    const projectDir = join(tmp, "with-wrapper-project");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "pom.xml"), `<?xml version="1.0"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>test</groupId>
  <artifactId>with-wrapper-project</artifactId>
  <version>1.0</version>
</project>`, "utf8");

    const jar = makeJar("wrapper-skill", { "wrapped-skill.md": "Loaded via mvnw" });
    const mvnw = join(projectDir, "mvnw");
    writeFileSync(mvnw, `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    -Dmdep.outputFile=*)
      outFile="\${arg#-Dmdep.outputFile=}"
      mkdir -p "$(dirname "$outFile")"
      printf '%s' '${jar}' > "$outFile"
      exit 0
      ;;
  esac
done
exit 1
`, "utf8");
    chmodSync(mvnw, 0o755);

    const skillsDir = await loadJarSkills(projectDir);
    try {
      assert.ok(skillsDir !== null, "expected a skills dir but got null");
      const skillFile = join(skillsDir!, "wrapped-skill.md");
      assert.ok(existsSync(skillFile), `expected ${skillFile} to exist`);
      assert.equal(readFileSync(skillFile, "utf8"), "Loaded via mvnw");
    } finally {
      if (skillsDir) rmSync(skillsDir, { recursive: true, force: true });
    }
  });

});

// ---------------------------------------------------------------------------
// loadJarSkills — integration
// ---------------------------------------------------------------------------

const bulmaJavaDir = join(homedir(), "workspace/t1/bulma-java");

describe("loadJarSkills (integration — requires bulma-java source)", { skip: !existsSync(bulmaJavaDir) }, () => {
  let fixtureDir: string;

  before(() => {
    const install = spawnSync("mvn", ["install", "-DskipTests", "-q"], {
      cwd: bulmaJavaDir,
      encoding: "utf8",
    });
    assert.equal(install.status, 0, `bulma-java install failed:\n${install.stderr}`);

    const { version } = parsePom(join(bulmaJavaDir, "pom.xml"));
    fixtureDir = mkdtempSync(join(tmpdir(), "jar-skills-fixture-"));
    writeFileSync(
      join(fixtureDir, "pom.xml"),
      `<?xml version="1.0"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>test</groupId>
  <artifactId>jar-skills-fixture</artifactId>
  <version>1.0</version>
  <dependencies>
    <dependency>
      <groupId>com.github.t1</groupId>
      <artifactId>bulma-java</artifactId>
      <version>${version}</version>
    </dependency>
  </dependencies>
</project>`,
      "utf8",
    );
  });

  after(() => rmSync(fixtureDir, { recursive: true, force: true }));

  it("returns a temp dir containing bulma-java.md", async () => {
    const skillsDir = await loadJarSkills(fixtureDir);
    try {
      assert.ok(skillsDir !== null, "expected a skills dir but got null");
      const skillFile = join(skillsDir!, "bulma-java.md");
      assert.ok(existsSync(skillFile), `expected ${skillFile} to exist`);
      const content = readFileSync(skillFile, "utf8");
      assert.ok(content.includes("bulma-java"), "skill content should mention bulma-java");
    } finally {
      if (skillsDir) rmSync(skillsDir, { recursive: true, force: true });
    }
  });
});
