import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePhase, formatWidgetLine } from "../progress-widget.ts";

describe("parsePhase", () => {
  it("returns null for unrecognized lines", () => {
    assert.equal(parsePhase("[INFO] Some other line"), null);
    assert.equal(parsePhase("[WARNING] something"), null);
    assert.equal(parsePhase(""), null);
  });

  it("returns the artifactId from a Building line", () => {
    assert.equal(
      parsePhase("[INFO] Building service-api 1.0.0-SNAPSHOT"),
      "service-api"
    );
  });

  it("returns the artifactId from a plain Building line with no version", () => {
    assert.equal(parsePhase("[INFO] Building my-module"), "my-module");
  });

  it("returns [artifactId] goal from a plugin goal line", () => {
    assert.equal(
      parsePhase("[INFO] --- maven-surefire-plugin:3.2.5:test (default-test) @ service-api ---"),
      "[service-api] test"
    );
  });

  it("returns [artifactId] goal from a failsafe plugin goal line", () => {
    assert.equal(
      parsePhase("[INFO] --- maven-failsafe-plugin:3.2.5:integration-test (default) @ orders ---"),
      "[orders] integration-test"
    );
  });
});

describe("formatWidgetLine", () => {
  it("formats elapsed, line count, and phase", () => {
    const line = formatWidgetLine(12, 847, "[service-api] test");
    assert.equal(line, "⚙ Maven  12s  |  847 lines  |  [service-api] test");
  });

  it("formats the initial resolving dependencies phase", () => {
    const line = formatWidgetLine(0, 0, "resolving dependencies");
    assert.equal(line, "⚙ Maven  0s  |  0 lines  |  resolving dependencies");
  });

  it("uses singular 'line' for exactly one line", () => {
    const line = formatWidgetLine(1, 1, "service-api");
    assert.equal(line, "⚙ Maven  1s  |  1 line  |  service-api");
  });
});
