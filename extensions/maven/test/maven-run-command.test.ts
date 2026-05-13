import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMavenCommand } from "../maven-run.ts";

describe("buildMavenCommand", () => {
  it("builds a plain test command", () => {
    const cmd = buildMavenCommand({ action: "test", runner: "./mvnw" });
    assert.equal(cmd, "./mvnw test");
  });

  it("adds -Dtest= for a class selector", () => {
    const cmd = buildMavenCommand({ action: "test", runner: "./mvnw", selector: "MyTest" });
    assert.equal(cmd, "./mvnw test -Dtest=MyTest");
  });

  it("quotes the selector when it contains a # (method selector)", () => {
    const cmd = buildMavenCommand({ action: "test", runner: "./mvnw", selector: "MyTest#myMethod" });
    assert.equal(cmd, "./mvnw test -Dtest='MyTest#myMethod'");
  });

  it("builds an integration-test command with failsafe flags and no selector", () => {
    const cmd = buildMavenCommand({ action: "integration-test", runner: "./mvnw" });
    assert.equal(cmd, "./mvnw verify -Dskip.surefire.tests -DskipITs=false");
  });

  it("adds -Dit.test= with quoting for integration-test method selector", () => {
    const cmd = buildMavenCommand({
      action: "integration-test",
      runner: "./mvnw",
      selector: "MyIT#myMethod",
    });
    assert.equal(cmd, "./mvnw verify -Dskip.surefire.tests -DskipITs=false -Dit.test='MyIT#myMethod'");
  });

  it("builds a verify command", () => {
    const cmd = buildMavenCommand({ action: "verify", runner: "mvn" });
    assert.equal(cmd, "mvn verify");
  });

  it("builds a package command with -DskipTests", () => {
    const cmd = buildMavenCommand({ action: "package", runner: "./mvnw" });
    assert.equal(cmd, "./mvnw package -DskipTests");
  });

  it("adds -pl <project> when project is specified", () => {
    const cmd = buildMavenCommand({
      action: "test",
      runner: "./mvnw",
      project: "services/service-a",
    });
    assert.equal(cmd, "./mvnw -pl services/service-a test");
  });
});
