import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMavenCommand } from "../maven-run.ts";

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
    assert.equal(cmd, "./mvnw -pl services/service-a test");
  });
});
