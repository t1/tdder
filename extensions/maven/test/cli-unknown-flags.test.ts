import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { checkUnknownFlags, parseArgs } from "../cli.ts";

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
});

// ---------------------------------------------------------------------------
// checkUnknownFlags
// ---------------------------------------------------------------------------

describe("checkUnknownFlags", () => {
  it("returns null when all flags are known", () => {
    const args = { scope: "surefire", project: "module-a", profiles: "at", _positional: "" };
    assert.equal(checkUnknownFlags(args, ["scope", "project", "profiles"]), null);
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
