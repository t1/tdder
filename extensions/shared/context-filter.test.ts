import { describe, expect, it } from "vitest";
import { filterDisplayOnlyMessages } from "./context-filter.ts";

function msg(role: string, customType?: string) {
  return { role, ...(customType !== undefined ? { customType } : {}) };
}

describe("filterDisplayOnlyMessages", () => {
  it("returns undefined when no messages match (fast path)", () => {
    const event = { messages: [msg("user"), msg("assistant"), msg("custom", "other")] };

    expect(filterDisplayOnlyMessages(event, "my-type")).toBeUndefined();
  });

  it("filters a single custom type", () => {
    const event = {
      messages: [msg("user"), msg("custom", "my-type"), msg("assistant")],
    };

    const result = filterDisplayOnlyMessages(event, "my-type");

    expect(result).toEqual({ messages: [msg("user"), msg("assistant")] });
  });

  it("filters multiple custom types", () => {
    const event = {
      messages: [
        msg("user"),
        msg("custom", "info"),
        msg("custom", "log"),
        msg("assistant"),
        msg("custom", "keep-this"),
      ],
    };

    const result = filterDisplayOnlyMessages(event, "info", "log");

    expect(result).toEqual({
      messages: [msg("user"), msg("assistant"), msg("custom", "keep-this")],
    });
  });

  it("does not filter custom messages with a different type", () => {
    const event = {
      messages: [msg("custom", "keep"), msg("custom", "remove")],
    };

    const result = filterDisplayOnlyMessages(event, "remove");

    expect(result).toEqual({ messages: [msg("custom", "keep")] });
  });

  it("does not filter non-custom messages", () => {
    const event = { messages: [msg("user"), msg("assistant"), msg("tool")] };

    expect(filterDisplayOnlyMessages(event, "user")).toBeUndefined();
  });

  it("returns undefined for an empty messages array", () => {
    expect(filterDisplayOnlyMessages({ messages: [] }, "any")).toBeUndefined();
  });

  it("handles missing customType gracefully", () => {
    const event = { messages: [msg("custom")] };

    expect(filterDisplayOnlyMessages(event, "some-type")).toBeUndefined();
  });
});
