import { describe, expect, it } from "vitest";
import { getToolPolicy, getToolPolicyRegistry, registerToolPolicy } from "./tool-policy.ts";

function fakePi() {
  return {} as any;
}

describe("tool policy registry", () => {
  it("creates one registry per pi instance", () => {
    const a = fakePi();
    const b = fakePi();

    expect(getToolPolicyRegistry(a)).not.toBe(getToolPolicyRegistry(b));
  });

  it("stores and reads tool policy by tool name", () => {
    const pi = fakePi();

    registerToolPolicy(pi, "task_block", { allowsAfterRequiresSessionRecreation: true });

    expect(getToolPolicy(pi, "task_block")).toEqual({ allowsAfterRequiresSessionRecreation: true });
  });

  it("merges repeated registrations", () => {
    const pi = fakePi();

    registerToolPolicy(pi, "task_block", { allowsAfterRequiresSessionRecreation: true });
    registerToolPolicy(pi, "task_block", {});

    expect(getToolPolicy(pi, "task_block")).toEqual({ allowsAfterRequiresSessionRecreation: true });
  });
});
