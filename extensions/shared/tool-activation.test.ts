import { describe, expect, it } from "vitest";
import { setToolsActive } from "./tool-activation.ts";

function fakeRegistry(allTools: string[], activeTools: string[]) {
  let current = [...activeTools];
  return {
    getAllTools: () => allTools.map((name) => ({ name })),
    getActiveTools: () => current,
    setActiveTools: (names: string[]) => { current = names; },
    get active() { return current; },
  };
}

describe("setToolsActive", () => {
  it("adds registered tools when active", () => {
    const pi = fakeRegistry(["a_foo", "a_bar", "b_baz"], ["b_baz"]);

    setToolsActive(pi, ["a_foo", "a_bar"], true);

    expect(pi.active).toEqual(["b_baz", "a_foo", "a_bar"]);
  });

  it("removes tools when inactive", () => {
    const pi = fakeRegistry(["a_foo", "a_bar", "b_baz"], ["b_baz", "a_foo", "a_bar"]);

    setToolsActive(pi, ["a_foo", "a_bar"], false);

    expect(pi.active).toEqual(["b_baz"]);
  });

  it("only adds tools that are registered", () => {
    const pi = fakeRegistry(["a_foo"], ["b_baz"]);

    setToolsActive(pi, ["a_foo", "a_missing"], true);

    expect(pi.active).toEqual(["b_baz", "a_foo"]);
  });

  it("preserves other extensions' tools", () => {
    const pi = fakeRegistry(["a_foo", "b_baz", "c_qux"], ["b_baz", "c_qux"]);

    setToolsActive(pi, ["a_foo"], true);

    expect(pi.active).toEqual(["b_baz", "c_qux", "a_foo"]);
  });

  it("is idempotent when activating already-active tools", () => {
    const pi = fakeRegistry(["a_foo", "b_baz"], ["b_baz", "a_foo"]);

    setToolsActive(pi, ["a_foo"], true);

    expect(pi.active).toEqual(["b_baz", "a_foo"]);
  });

  it("is idempotent when deactivating already-inactive tools", () => {
    const pi = fakeRegistry(["a_foo", "b_baz"], ["b_baz"]);

    setToolsActive(pi, ["a_foo"], false);

    expect(pi.active).toEqual(["b_baz"]);
  });
});
