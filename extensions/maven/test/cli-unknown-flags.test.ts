import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { checkUnknownFlags, parseArgs, parseRunFlags } from "../cli.ts";

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("parses --key value (space-separated)", () => {
    const { args } = parseArgs(["test", "--scope", "surefire"]);
    assert.equal(args.scope, "surefire");
  });

  it("parses --key=value (equals syntax)", () => {
    const { args } = parseArgs(["test", "--limit=5"]);
    assert.equal(args.limit, "5");
  });

  it("parses --profiles=value", () => {
    const { args } = parseArgs(["test", "--profiles=at,rules"]);
    assert.equal(args.profiles, "at,rules");
  });

  it("parses --key=none (equals with string value)", () => {
    const { args } = parseArgs(["test", "--limit=none"]);
    assert.equal(args.limit, "none");
  });

  it("treats a bare --flag with no value as boolean true", () => {
    const { args } = parseArgs(["test", "--include-timings"]);
    assert.equal(args["include-timings"], true);
  });

  it("parses --update-snapshots as boolean true", () => {
    const { args } = parseArgs(["test", "--update-snapshots"]);
    assert.equal(args["update-snapshots"], true);
  });

  it("parses --offline as boolean true", () => {
    const { args } = parseArgs(["test", "--offline"]);
    assert.equal(args.offline, true);
  });

  it("collects -Dkey=value tokens into a property array", () => {
    const { args } = parseArgs(["test", "--scope", "surefire", "-Dfoo=1", "-Dbar=2"]);
    assert.deepEqual((args.property as string[]), ["foo=1", "bar=2"]);
  });

  it("collects repeated --property flags into an array", () => {
    const { args } = parseArgs(["test", "--property", "a=1", "--property", "b=2"]);
    assert.deepEqual((args.property as string[]), ["a=1", "b=2"]);
  });

  it("mixes -D tokens and --property flags; flag values may still start with -D", () => {
    const { args } = parseArgs(["test", "--selector", "-Dnot-a-property", "-Dreal=1"]);
    assert.equal(args.selector, "-Dnot-a-property");
    assert.deepEqual((args.property as string[]), ["real=1"]);
  });

  it("keeps -D tokens out of the positional arguments", () => {
    const { args, command } = parseArgs(["lookup-version", "org.assertj", "-DskipTests"]);
    assert.equal(command, "lookup-version");
    assert.equal(args._positional, "org.assertj");
    assert.deepEqual((args.property as string[]), ["skipTests"]);
  });
});

// ---------------------------------------------------------------------------
// parseRunFlags
// ---------------------------------------------------------------------------

describe("parseRunFlags", () => {
  it("maps CLI flags to Maven run options", () => {
    const flags = parseRunFlags(
      { "update-snapshots": true, offline: true, property: ["foo=1", "bar"], profiles: "at, rules", project: "module-a", selector: "MyTest#x", _positional: "" },
      "default-module",
    );
    assert.deepEqual(flags, {
      selector: "MyTest#x",
      project: "module-a",
      profiles: ["at", "rules"],
      forceUpdate: true,
      offline: true,
      properties: { foo: "1", bar: "" },
    });
  });

  it("falls back to the default project when none is given", () => {
    const flags = parseRunFlags({ _positional: "" }, "default-module");
    assert.equal(flags.project, "default-module");
  });

  it("yields no project when no default is given", () => {
    const flags = parseRunFlags({ _positional: "" }, undefined);
    assert.equal(flags.project, undefined);
  });
});

// ---------------------------------------------------------------------------
// checkUnknownFlags
// ---------------------------------------------------------------------------

describe("checkUnknownFlags", () => {
  it("returns null when all flags are known", () => {
    const args = { scope: "surefire", project: "module-a", profiles: "at", "update-snapshots": true, _positional: "" };
    assert.equal(checkUnknownFlags(args, ["scope", "project", "profiles", "update-snapshots"]), null);
  });

  it("returns an error message listing the unknown flag", () => {
    const args = { scope: "surefire", typo: true, _positional: "" };
    const msg = checkUnknownFlags(args, ["scope"]);
    assert.ok(msg !== null, "expected an error message");
    assert.ok(msg!.includes("--typo"), `expected --typo in: ${msg}`);
  });

  it("returns an error message listing multiple unknown flags", () => {
    const args = { scope: "surefire", foo: true, bar: "baz", _positional: "" };
    const msg = checkUnknownFlags(args, ["scope"]);
    assert.ok(msg !== null);
    assert.ok(msg!.includes("--foo"), `expected --foo in: ${msg}`);
    assert.ok(msg!.includes("--bar"), `expected --bar in: ${msg}`);
  });

  it("ignores the internal _positional key", () => {
    const args = { scope: "surefire", _positional: "groupId artifactId" };
    assert.equal(checkUnknownFlags(args, ["scope"]), null);
  });
});
