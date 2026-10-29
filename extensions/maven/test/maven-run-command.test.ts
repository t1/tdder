import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { buildMavenArgs, buildMavenCommand, buildMavenEnv, parseMavenRunTokens, parsePropertyTokens } from "../maven-run.ts";

describe("buildMavenCommand", () => {
  it("builds a surefire (unit test) command", () => {
    const cmd = buildMavenCommand({ action: "test", runner: "./mvnw", testScope: "surefire" });
    assert.equal(cmd, "./mvnw test");
  });

  it("adds -Dtest= for a surefire class selector", () => {
    const cmd = buildMavenCommand({ action: "test", runner: "./mvnw", testScope: "surefire", selector: "MyTest" });
    assert.equal(cmd, "./mvnw test -Dtest=MyTest");
  });

  it("quotes the selector when it contains a # (surefire method selector)", () => {
    const cmd = buildMavenCommand({ action: "test", runner: "./mvnw", testScope: "surefire", selector: "MyTest#myMethod" });
    assert.equal(cmd, "./mvnw test -Dtest='MyTest#myMethod'");
  });

  it("builds a failsafe-only command with skip.surefire.tests", () => {
    const cmd = buildMavenCommand({ action: "test", runner: "./mvnw", testScope: "failsafe" });
    assert.equal(cmd, "./mvnw verify -Dskip.surefire.tests=true -DskipITs=false");
  });

  it("adds -Dit.test= with quoting for failsafe method selector", () => {
    const cmd = buildMavenCommand({
      action: "test",
      runner: "./mvnw",
      testScope: "failsafe",
      selector: "MyIT#myMethod",
    });
    assert.equal(cmd, "./mvnw verify -Dskip.surefire.tests=true -DskipITs=false -Dit.test='MyIT#myMethod'");
  });

  it("builds an all-tests command (surefire + failsafe)", () => {
    const cmd = buildMavenCommand({ action: "test", runner: "./mvnw", testScope: "all" });
    assert.equal(cmd, "./mvnw verify -DskipITs=false");
  });

  it("adds -Dit.test= for all-tests selector", () => {
    const cmd = buildMavenCommand({ action: "test", runner: "./mvnw", testScope: "all", selector: "MyIT" });
    assert.equal(cmd, "./mvnw verify -DskipITs=false -Dit.test=MyIT");
  });

  it("builds a package command with -DskipTests", () => {
    const cmd = buildMavenCommand({ action: "package", runner: "./mvnw" });
    assert.equal(cmd, "./mvnw package -DskipTests");
  });

  it("adds -pl <project> when project is specified", () => {
    const cmd = buildMavenCommand({
      action: "test",
      runner: "./mvnw",
      testScope: "surefire",
      project: "services/service-a",
    });
    assert.equal(cmd, "./mvnw -pl services/service-a -am test");
  });

  it("adds -P<profiles> when profiles are specified", () => {
    const cmd = buildMavenCommand({
      action: "test",
      runner: "./mvnw",
      testScope: "all",
      profiles: ["at", "rules"],
    });
    assert.equal(cmd, "./mvnw -Pat,rules verify -DskipITs=false");
  });

  it("adds --update-snapshots when forceUpdate is requested", () => {
    const cmd = buildMavenCommand({
      action: "test",
      runner: "./mvnw",
      testScope: "surefire",
      forceUpdate: true,
    });
    assert.equal(cmd, "./mvnw --update-snapshots test");
  });

  it("shows --offline and -Dkey=value properties", () => {
    const cmd = buildMavenCommand({
      action: "package",
      runner: "./mvnw",
      offline: true,
      properties: { "quarkus.native.enabled": "true" },
    });
    assert.equal(cmd, "./mvnw --offline package -DskipTests -Dquarkus.native.enabled=true");
  });

  it("quotes a property value containing spaces", () => {
    const cmd = buildMavenCommand({
      action: "test",
      runner: "./mvnw",
      testScope: "surefire",
      properties: { "test.tags": "slow and flaky" },
    });
    assert.equal(cmd, "./mvnw test '-Dtest.tags=slow and flaky'");
  });
});

describe("buildMavenEnv", () => {
  it("sets TMPDIR to <projectRoot>/target", () => {
    const env = buildMavenEnv("/my/project", {});
    assert.equal(env.TMPDIR, "/my/project/target");
  });

  it("sets MAVEN_OPTS with java.io.tmpdir and user.home when no prior MAVEN_OPTS", () => {
    const env = buildMavenEnv("/my/project", {});
    assert.equal(
      env.MAVEN_OPTS,
      `-Djava.io.tmpdir=/my/project/target -Duser.home=/my/project/target -Dmaven.repo.local=${homedir()}/.m2/repository`,
    );
  });

  it("appends java.io.tmpdir and user.home to existing MAVEN_OPTS", () => {
    const env = buildMavenEnv("/my/project", { MAVEN_OPTS: "-Xmx512m" });
    assert.equal(
      env.MAVEN_OPTS,
      `-Xmx512m -Djava.io.tmpdir=/my/project/target -Duser.home=/my/project/target -Dmaven.repo.local=${homedir()}/.m2/repository`,
    );
  });

  it("preserves other env vars", () => {
    const env = buildMavenEnv("/my/project", { HOME: "/home/user", PATH: "/usr/bin" });
    assert.equal(env.HOME, "/home/user");
    assert.equal(env.PATH, "/usr/bin");
  });

  it("pins maven.repo.local to the real home so the local repo is not redirected into target", () => {
    const env = buildMavenEnv("/my/project", { HOME: "/home/user" });
    assert.equal(
      env.MAVEN_OPTS,
      "-Djava.io.tmpdir=/my/project/target -Duser.home=/my/project/target -Dmaven.repo.local=/home/user/.m2/repository",
    );
  });

  it("falls back to os.homedir for maven.repo.local when HOME is unset", () => {
    const env = buildMavenEnv("/my/project", {});
    assert.match(env.MAVEN_OPTS!, /-Dmaven\.repo\.local=\S+\/\.m2\/repository$/);
    assert.ok(!env.MAVEN_OPTS!.includes("-Dmaven.repo.local=/my/project/target"));
  });
});

describe("buildMavenArgs", () => {
  it("builds surefire argv array", () => {
    const args = buildMavenArgs({ action: "test", runner: "./mvnw", testScope: "surefire" });
    assert.deepEqual(args, ["./mvnw", "test"]);
  });

  it("adds -Dtest= for a surefire class selector without quoting", () => {
    const args = buildMavenArgs({ action: "test", runner: "./mvnw", testScope: "surefire", selector: "MyTest" });
    assert.deepEqual(args, ["./mvnw", "test", "-Dtest=MyTest"]);
  });

  it("passes method selector raw (no shell quoting) for surefire", () => {
    const args = buildMavenArgs({ action: "test", runner: "./mvnw", testScope: "surefire", selector: "MyTest#myMethod" });
    assert.deepEqual(args, ["./mvnw", "test", "-Dtest=MyTest#myMethod"]);
  });

  it("builds failsafe argv array", () => {
    const args = buildMavenArgs({ action: "test", runner: "./mvnw", testScope: "failsafe" });
    assert.deepEqual(args, ["./mvnw", "verify", "-Dskip.surefire.tests=true", "-DskipITs=false"]);
  });

  it("passes method selector raw (no shell quoting) for failsafe", () => {
    const args = buildMavenArgs({ action: "test", runner: "./mvnw", testScope: "failsafe", selector: "MyIT#myMethod" });
    assert.deepEqual(args, ["./mvnw", "verify", "-Dskip.surefire.tests=true", "-DskipITs=false", "-Dit.test=MyIT#myMethod"]);
  });

  it("builds all-tests argv array", () => {
    const args = buildMavenArgs({ action: "test", runner: "./mvnw", testScope: "all" });
    assert.deepEqual(args, ["./mvnw", "verify", "-DskipITs=false"]);
  });

  it("adds -Dit.test= for all-tests selector without quoting", () => {
    const args = buildMavenArgs({ action: "test", runner: "./mvnw", testScope: "all", selector: "MyIT" });
    assert.deepEqual(args, ["./mvnw", "verify", "-DskipITs=false", "-Dit.test=MyIT"]);
  });

  it("builds package argv array", () => {
    const args = buildMavenArgs({ action: "package", runner: "./mvnw" });
    assert.deepEqual(args, ["./mvnw", "package", "-DskipTests"]);
  });

  it("adds -pl when project is specified", () => {
    const args = buildMavenArgs({ action: "test", runner: "./mvnw", testScope: "surefire", project: "services/service-a" });
    assert.deepEqual(args, ["./mvnw", "-pl", "services/service-a", "-am", "test"]);
  });

  it("adds -P when profiles are specified", () => {
    const args = buildMavenArgs({ action: "test", runner: "./mvnw", testScope: "all", profiles: ["at", "rules"] });
    assert.deepEqual(args, ["./mvnw", "-Pat,rules", "verify", "-DskipITs=false"]);
  });

  it("adds --update-snapshots when forceUpdate is requested", () => {
    const args = buildMavenArgs({ action: "test", runner: "./mvnw", testScope: "surefire", forceUpdate: true });
    assert.deepEqual(args, ["./mvnw", "--update-snapshots", "test"]);
  });
});

describe("buildMavenArgs — properties", () => {
  it("appends a single -Dkey=value property", () => {
    const args = buildMavenArgs({ action: "test", runner: "./mvnw", testScope: "surefire", properties: { "quarkus.test.tags": "slow" } });
    assert.deepEqual(args, ["./mvnw", "test", "-Dquarkus.test.tags=slow"]);
  });

  it("appends multiple -Dkey=value properties in order", () => {
    const args = buildMavenArgs({ action: "test", runner: "./mvnw", testScope: "surefire", properties: { foo: "1", bar: "2" } });
    assert.deepEqual(args, ["./mvnw", "test", "-Dfoo=1", "-Dbar=2"]);
  });

  it("places properties after the selector so they override curated flags (Maven's last -D wins)", () => {
    const args = buildMavenArgs({
      action: "test",
      runner: "./mvnw",
      testScope: "failsafe",
      selector: "MyIT",
      properties: { "it.test": "OtherIT" },
    });
    assert.deepEqual(args, ["./mvnw", "verify", "-Dskip.surefire.tests=true", "-DskipITs=false", "-Dit.test=MyIT", "-Dit.test=OtherIT"]);
  });

  it("rejects a property key containing '='", () => {
    assert.throws(
      () => buildMavenArgs({ action: "test", runner: "./mvnw", testScope: "surefire", properties: { "a=b": "1" } }),
      /Invalid Maven property key/,
    );
  });

  it("rejects a property key containing whitespace", () => {
    assert.throws(
      () => buildMavenArgs({ action: "test", runner: "./mvnw", testScope: "surefire", properties: { "a b": "1" } }),
      /Invalid Maven property key/,
    );
  });

  it("rejects a property key with a leading -D prefix (double-prefix mistake)", () => {
    assert.throws(
      () => buildMavenArgs({ action: "test", runner: "./mvnw", testScope: "surefire", properties: { "-Dfoo": "1" } }),
      { message: /Invalid Maven property key '-Dfoo'.*no leading/ },
    );
  });
});

describe("buildMavenArgs — offline", () => {
  it("adds --offline when offline is requested", () => {
    const args = buildMavenArgs({ action: "test", runner: "./mvnw", testScope: "surefire", offline: true });
    assert.deepEqual(args, ["./mvnw", "--offline", "test"]);
  });

  it("adds --offline before properties", () => {
    const args = buildMavenArgs({ action: "package", runner: "./mvnw", offline: true, properties: { foo: "1" } });
    assert.deepEqual(args, ["./mvnw", "--offline", "package", "-DskipTests", "-Dfoo=1"]);
  });

  it("rejects offline combined with forceUpdate", () => {
    assert.throws(
      () => buildMavenArgs({ action: "test", runner: "./mvnw", testScope: "surefire", offline: true, forceUpdate: true }),
      /offline.*mutually exclusive|mutually exclusive.*offline/i,
    );
  });
});

describe("parsePropertyTokens", () => {
  it("converts key=value tokens to a record", () => {
    assert.deepEqual(parsePropertyTokens(["foo=1", "bar=2"]), { foo: "1", bar: "2" });
  });

  it("splits on the first '=' only, so values may contain '='", () => {
    assert.deepEqual(parsePropertyTokens(["tags=a=b"]), { tags: "a=b" });
  });

  it("maps a value-less token to the empty string (like -Dflag)", () => {
    assert.deepEqual(parsePropertyTokens(["skipTests"]), { skipTests: "" });
  });

  it("lets later duplicates win, like Maven's last -D", () => {
    assert.deepEqual(parsePropertyTokens(["a=1", "a=2"]), { a: "2" });
  });

  it("returns an empty record for undefined", () => {
    assert.deepEqual(parsePropertyTokens(undefined), {});
  });

  it("accepts a single string token", () => {
    assert.deepEqual(parsePropertyTokens("foo=1"), { foo: "1" });
  });
});

describe("parseMavenRunTokens", () => {
  it("extracts -D properties and offline flags, leaving the rest", () => {
    const { properties, offline, rest } = parseMavenRunTokens(["surefire", "-Dfoo=1", "MyTest#x", "--offline", "-Dbar"]);
    assert.deepEqual(properties, { foo: "1", bar: "" });
    assert.equal(offline, true);
    assert.deepEqual(rest, ["surefire", "MyTest#x"]);
  });

  it("accepts -o as the offline shorthand", () => {
    const { offline, rest } = parseMavenRunTokens(["package", "-o"]);
    assert.equal(offline, true);
    assert.deepEqual(rest, ["package"]);
  });

  it("returns empty properties, no offline, and all tokens for plain arguments", () => {
    const { properties, offline, rest } = parseMavenRunTokens(["all", "MyIT"]);
    assert.deepEqual(properties, {});
    assert.equal(offline, false);
    assert.deepEqual(rest, ["all", "MyIT"]);
  });
});
