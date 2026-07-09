import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { buildMavenArgs, buildMavenCommand, buildMavenEnv } from "../maven-run.ts";

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
});

describe("buildMavenEnv", () => {
  it("sets TMPDIR to <projectRoot>/target", () => {
    const env = buildMavenEnv("/my/project", {});
    assert.equal(env.TMPDIR, "/my/project/target");
  });

  it("sets MAVEN_OPTS with java.io.tmpdir and user.home when no prior MAVEN_OPTS", () => {
    const env = buildMavenEnv("/my/project", {});
    assert.equal(env.MAVEN_OPTS, "-Djava.io.tmpdir=/my/project/target -Duser.home=/my/project/target");
  });

  it("appends java.io.tmpdir and user.home to existing MAVEN_OPTS", () => {
    const env = buildMavenEnv("/my/project", { MAVEN_OPTS: "-Xmx512m" });
    assert.equal(env.MAVEN_OPTS, "-Xmx512m -Djava.io.tmpdir=/my/project/target -Duser.home=/my/project/target");
  });

  it("preserves other env vars", () => {
    const env = buildMavenEnv("/my/project", { HOME: "/home/user", PATH: "/usr/bin" });
    assert.equal(env.HOME, "/home/user");
    assert.equal(env.PATH, "/usr/bin");
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
